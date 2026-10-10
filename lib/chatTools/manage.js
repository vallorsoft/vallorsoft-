// ============================================================
//  VallorSoft — lib/chatTools/manage.js
//  💬 AI-chat 2.0 — 4. kör: a maradék törzsadat- és beállítás-kezelés.
//   - alvállalkozó módosítása / törlése, csoportjai, jármű követő-linkje,
//     alvállalkozói számla törlése
//   - ügyfél törlése, meghívók listája + visszavonása,
//     ügyfél-/alvállalkozói portál-belépők listája + letiltása
//   - kedvenc helyszínek listája + törlése, árajánlat módosítása
//   - tranzakciós e-mail sablonok: lista, szöveg módosítása, küldés
//   - költség-kalkulátor költségtételei (jármű / sofőr / cég)
//   - fuvar-sorozatok, útdíj-ráták, tanult adatok, kiküldött levelek naplója
//  Írás MINDIG a meglévő handleren (vagy a REST közös függvényén) át,
//  company_id-szűrten. Titok (API-kulcs, jelszó) chatből NEM állítható.
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
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const info = (html) => '<div class="och-info">' + html + '</div>';
const yes = (ctx, v) => (v ? (hu(ctx) ? 'aktív' : 'activ') : (hu(ctx) ? '⛔ letiltva' : '⛔ blocat'));

// ─── Feloldók (mind cégre szűrve) ───
async function carrierRow(ctx, id) {
  return (await q(`SELECT * FROM carriers WHERE id = $1 AND company_id = $2`, [id, ctx.cid]))[0] || null;
}
async function findCarrierGroup(ctx, raw) {
  const s = core.fmt.fold(String(raw || '').trim());
  if (!s) return { err: hu(ctx) ? 'Melyik csoport?' : 'Care grup?' };
  const rows = await q(`SELECT id, name FROM carrier_groups WHERE company_id = $1 ORDER BY name`, [ctx.cid]);
  const exact = rows.filter((g) => core.fmt.fold(g.name) === s);
  const hits = exact.length ? exact : rows.filter((g) => core.fmt.fold(g.name).includes(s));
  if (hits.length === 1) return { g: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több csoport is illik rá — melyik?' : 'Se potrivesc mai multe grupuri — care?', options: hits.slice(0, 5).map((g) => ctx.retext(g.name, String(raw))) } };
  return { err: (hu(ctx) ? 'Nincs ilyen csoport: ' : 'Nu există grupul: ') + raw };
}
async function findPortalUser(ctx, email) {
  const e = String(email || '').trim().toLowerCase();
  const c = await q(`SELECT cu.id, cu.email, cu.nev, cu.activ, c.denumire AS org FROM client_users cu
                      JOIN clients c ON c.id = cu.client_id AND c.company_id = cu.company_id
                     WHERE cu.company_id = $1 AND LOWER(cu.email) = $2`, [ctx.cid, e]);
  if (c[0]) return { kind: 'client', u: c[0] };
  const k = await q(`SELECT cu.id, cu.email, cu.nev, cu.activ, c.nev AS org FROM carrier_users cu
                      JOIN carriers c ON c.id = cu.carrier_id AND c.company_id = cu.company_id
                     WHERE cu.company_id = $1 AND LOWER(cu.email) = $2`, [ctx.cid, e]);
  if (k[0]) return { kind: 'carrier', u: k[0] };
  return { err: (hu(ctx) ? 'Nincs ilyen portál-belépő: ' : 'Nu există acest acces în portal: ') + email };
}
async function findQuote(ctx, raw) {
  const s = String(raw || '').trim();
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  if (n && /^#?\d+$/.test(s)) {
    const r = await q(`SELECT * FROM quotes WHERE id = $1 AND company_id = $2`, [n, ctx.cid]);
    if (r[0]) return { qt: r[0] };
  }
  const rows = await q(`SELECT * FROM quotes WHERE company_id = $1 AND status IN ('draft','sent') ORDER BY created_at DESC LIMIT 50`, [ctx.cid]);
  const f = core.fmt.fold(s);
  const hits = f ? rows.filter((x) => core.fmt.fold(x.client_name || '').includes(f)) : rows;
  if (hits.length === 1) return { qt: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több ajánlat is illik rá — melyik? (#szám)' : 'Se potrivesc mai multe oferte — care? (#număr)', options: hits.slice(0, 5).map((x) => ctx.retext('#' + x.id, s)) } };
  return { err: (hu(ctx) ? 'Nem találom ezt az ajánlatot: ' : 'Nu găsesc oferta: ') + s };
}
async function findFavLoc(ctx, raw) {
  const f = core.fmt.fold(String(raw || '').trim());
  const rows = await q(`SELECT id, label, address, type FROM favorite_locations WHERE company_id = $1 ORDER BY label`, [ctx.cid]);
  const hits = rows.filter((x) => core.fmt.fold(x.label).includes(f) || core.fmt.fold(x.address || '').includes(f));
  if (hits.length === 1) return { l: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több hely is illik rá — melyik?' : 'Se potrivesc mai multe locații — care?', options: hits.slice(0, 5).map((x) => ctx.retext(x.label, String(raw))) } };
  return { err: (hu(ctx) ? 'Nincs ilyen mentett hely: ' : 'Nu există locația salvată: ') + raw };
}
async function driverId(ctx, email) {
  const r = await q(`SELECT id FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2) AND pozicio = 'Sofer' LIMIT 1`, [ctx.cid, email]);
  return r[0] ? r[0].id : null;
}

const TPL_KEYS = ['order_confirm_carrier', 'order_status_change', 'quote_send', 'invoice_notify', 'generic'];
const TPL_NAME = {
  order_confirm_carrier: L('Fuvar-visszaigazolás', 'Confirmare transport'), order_status_change: L('Státusz-változás', 'Schimbare status'),
  quote_send: L('Árajánlat', 'Ofertă'), invoice_notify: L('Számla-értesítő', 'Notificare factură'), generic: L('Általános levél', 'Mesaj general'),
};
const tplName = (ctx, k) => (TPL_NAME[k] ? TPL_NAME[k][ctx.lang] || TPL_NAME[k].hu : k);
const MEM_KINDS = ['firma_addr', 'pickup_client', 'client_cargo', 'driver_alias', 'mail_pref', 'mail_style', 'mail_tpl'];
const LEARN_KINDS = MEM_KINDS.concat(['order_scan', 'chat_miss', 'chat_intent']);

module.exports = [
  // ─── Alvállalkozók ───
  {
    name: 'carrier.update', domain: 'carriers', kind: 'write', feature: 'external-drivers',
    title: L('Alvállalkozó módosítása', 'Modificare subcontractor'),
    desc: L('Meglévő alvállalkozó adatainak módosítása (a többi adata megmarad): carrier, name, cui, email, phone, iban, reg_com, address, payment_term_days, active (igen/nem).', 'Modifică datele unui subcontractor.'),
    examples: L(['a Trans Kft fizetési határideje legyen 45 nap'], ['termenul de plată la Trans SRL să fie 45 de zile']),
    params: { carrier: { type: 'carrier', required: true }, name: { type: 'text', max: 255 }, cui: { type: 'text', max: 40 }, email: { type: 'email' }, phone: { type: 'text', max: 50 },
      iban: { type: 'text', max: 40 }, reg_com: { type: 'text', max: 60 }, address: { type: 'text', max: 500 }, payment_term_days: { type: 'int', min: 0, maxv: 365 }, active: { type: 'bool' } },
    async check(ctx, a) {
      const keys = ['name', 'cui', 'email', 'phone', 'iban', 'reg_com', 'address', 'payment_term_days', 'active'];
      if (!keys.some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Mit módosítsak az alvállalkozón?' : 'Ce modific la subcontractor?', options: [] } };
      a.row = await carrierRow(ctx, a.carrier.id);
      if (!a.row) return { err: hu(ctx) ? 'Nem találom az alvállalkozót.' : 'Nu găsesc subcontractorul.' };
      return null;
    },
    async preview(ctx, a) {
      const c = a.row; const rows = [['🚚', c.nev]];
      if (a.name != null) rows.push([hu(ctx) ? 'Név' : 'Denumire', change(c.nev, a.name)]);
      if (a.cui != null) rows.push(['CUI', change(c.cui, a.cui)]);
      if (a.email != null) rows.push(['E-mail', change(c.email, a.email)]);
      if (a.phone != null) rows.push(['Telefon', change(c.telefon, a.phone)]);
      if (a.iban != null) rows.push(['IBAN', change(c.iban, a.iban)]);
      if (a.reg_com != null) rows.push(['Reg. Com.', change(c.reg_com, a.reg_com)]);
      if (a.address != null) rows.push([hu(ctx) ? 'Cím' : 'Adresă', change(c.adresa, a.address)]);
      if (a.payment_term_days != null) rows.push([hu(ctx) ? 'Fiz. határidő' : 'Termen plată', change(c.payment_term_days, a.payment_term_days)]);
      if (a.active != null) rows.push([hu(ctx) ? 'Állapot' : 'Stare', change(yes(ctx, c.aktiv), yes(ctx, a.active))]);
      return { rows, label: c.nev };
    },
    async snapshot(ctx, a) { return { row: a.row }; },
    async undo(ctx, b) {
      const c = b && b.row; if (!c) return { ok: false };
      return core.callH(H('carriers', 'carrierSave'), ctx.req, [{ id: c.id, nev: c.nev, cui: c.cui, email: c.email, telefon: c.telefon, iban: c.iban, nota: c.nota,
        reg_com: c.reg_com, adresa: c.adresa, payment_term_days: c.payment_term_days, cmr_insurance_expiry: d10(c.cmr_insurance_expiry) || null, aktiv: c.aktiv }]);
    },
    async run(ctx, a) {
      const c = a.row;
      // A mentő handler MINDEN mezőt felülír → a jelenlegi értékekkel egészítjük ki.
      const r = await core.callH(H('carriers', 'carrierSave'), ctx.req, [{ id: c.id,
        nev: a.name != null ? a.name : c.nev, cui: a.cui != null ? a.cui : c.cui, email: a.email != null ? a.email : c.email,
        telefon: a.phone != null ? a.phone : c.telefon, iban: a.iban != null ? a.iban : c.iban, nota: c.nota,
        reg_com: a.reg_com != null ? a.reg_com : c.reg_com, adresa: a.address != null ? a.address : c.adresa,
        payment_term_days: a.payment_term_days != null ? a.payment_term_days : c.payment_term_days,
        cmr_insurance_expiry: d10(c.cmr_insurance_expiry) || null, aktiv: a.active != null ? a.active : c.aktiv }]);
      return r && r.ok ? ok(null, { entity_id: c.id }) : r;
    },
  },
  {
    name: 'carrier.delete', domain: 'carriers', kind: 'danger', feature: 'external-drivers',
    title: L('Alvállalkozó törlése', 'Ștergere subcontractor'),
    desc: L('Alvállalkozó végleges törlése (portál-belépőivel és járműveivel együtt). Ha van hozzá szállítói számla, nem törölhető — ilyenkor carrier.update active=nem.', 'Șterge definitiv un subcontractor.'),
    params: { carrier: { type: 'carrier', required: true } },
    async preview(ctx, a) { return { rows: [['🚚', a.carrier.name]], label: a.carrier.name }; },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierDelete'), ctx.req, [a.carrier.id]);
      if (r && r.ok === false && !r.err) return { ok: false, err: hu(ctx) ? 'Nem sikerült törölni.' : 'Nu s-a putut șterge.' };
      return r && r.ok ? ok(null, { entity_id: a.carrier.id }) : r;
    },
  },
  {
    name: 'carrier.invoice_delete', domain: 'carriers', kind: 'danger', feature: 'invoices-in',
    title: L('Szállítói számla törlése', 'Ștergere factură furnizor'),
    desc: L('Egy rögzített alvállalkozói (bejövő) számla törlése: invoice = a számla száma, carrier (opcionális szűkítés).', 'Șterge o factură de furnizor înregistrată.'),
    params: { invoice: { type: 'text', required: true, max: 80 }, carrier: { type: 'carrier' } },
    async check(ctx, a) {
      const params = [ctx.cid, String(a.invoice).trim().toUpperCase()];
      let sql = `SELECT ci.id, ci.invoice_number, ci.amount, ci.currency, ci.status, c.nev FROM carrier_invoices ci
                   JOIN carriers c ON c.id = ci.carrier_id AND c.company_id = ci.company_id
                  WHERE ci.company_id = $1 AND UPPER(TRIM(ci.invoice_number)) = $2`;
      if (a.carrier) { params.push(a.carrier.id); sql += ' AND ci.carrier_id = $3'; }
      const r = await q(sql, params);
      if (!r.length) return { err: (hu(ctx) ? 'Nem találom ezt a szállítói számlát: ' : 'Nu găsesc factura de furnizor: ') + a.invoice };
      if (r.length > 1) return { err: hu(ctx) ? 'Több alvállalkozónál is van ilyen számlaszám — add meg az alvállalkozót is.' : 'Numărul apare la mai mulți subcontractori — precizează subcontractorul.' };
      a.inv = r[0];
      return null;
    },
    async preview(ctx, a) {
      const i = a.inv;
      return { rows: [[hu(ctx) ? 'Számla' : 'Factură', i.invoice_number], [hu(ctx) ? 'Alvállalkozó' : 'Subcontractor', i.nev], [hu(ctx) ? 'Összeg' : 'Sumă', fmtN(num(i.amount), 2) + ' ' + i.currency], [hu(ctx) ? 'Állapot' : 'Stare', i.status]], label: i.invoice_number };
    },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierInvoiceDelete'), ctx.req, [a.inv.id]);
      return r && r.ok ? ok(null, { entity_id: a.inv.id }) : { ok: false, err: (r && r.err) || (hu(ctx) ? 'Nem sikerült törölni.' : 'Nu s-a putut șterge.') };
    },
  },
  {
    name: 'carrier.group_list', domain: 'carriers', kind: 'read', feature: 'external-drivers',
    desc: L('Az alvállalkozó-csoportok listája (hány alvállalkozó van bennük).', 'Lista grupurilor de subcontractori.'),
    async run(ctx) {
      const r = await core.callH(H('carriers', 'carrierGroupList'), ctx.req, []);
      const rows = (r && r.items) || [];
      return { reply: hu(ctx) ? rows.length + ' csoport.' : rows.length + ' grupuri.', html: info(listCard(ctx, '🗂️', hu(ctx) ? 'Alvállalkozó-csoportok' : 'Grupuri subcontractori', rows,
        [{ k: 'name', l: L('Név', 'Nume') }, { k: 'carrier_count', l: L('Alvállalkozó', 'Subcontractori') }])) };
    },
  },
  {
    name: 'carrier.group_save', domain: 'carriers', kind: 'write', feature: 'external-drivers',
    title: L('Alvállalkozó-csoport', 'Grup subcontractori'),
    desc: L('Új alvállalkozó-csoport létrehozása (name), vagy meglévő átnevezése (group = régi név, name = új név).', 'Creează sau redenumește un grup de subcontractori.'),
    examples: L(['hozz létre egy „Magyar fuvarozók” csoportot'], ['creează grupul „Transportatori HU”']),
    params: { name: { type: 'text', required: true, max: 120 }, group: { type: 'text', max: 120 } },
    async check(ctx, a) {
      if (a.group) { const f = await findCarrierGroup(ctx, a.group); if (f.err || f.ask) return f; a.g = f.g; }
      return null;
    },
    async preview(ctx, a) { return { rows: a.g ? [[hu(ctx) ? 'Csoport' : 'Grup', change(a.g.name, a.name)]] : [[hu(ctx) ? 'Új csoport' : 'Grup nou', a.name]], label: a.name }; },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierGroupSave'), ctx.req, [{ id: a.g ? a.g.id : null, name: a.name }]);
      return r && r.ok ? ok(null, { entity_id: r.id }) : r;
    },
  },
  {
    name: 'carrier.group_delete', domain: 'carriers', kind: 'write', feature: 'external-drivers',
    title: L('Alvállalkozó-csoport törlése', 'Ștergere grup'),
    desc: L('Csoport törlése (az alvállalkozók megmaradnak, csak csoport nélkül).', 'Șterge un grup (subcontractorii rămân).'),
    params: { group: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) { const f = await findCarrierGroup(ctx, a.group); if (f.err || f.ask) return f; a.g = f.g; return null; },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Csoport' : 'Grup', a.g.name]], label: a.g.name }; },
    async run(ctx, a) { const r = await core.callH(H('carriers', 'carrierGroupDelete'), ctx.req, [a.g.id]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'carrier.set_group', domain: 'carriers', kind: 'write', feature: 'external-drivers',
    title: L('Alvállalkozó csoportja', 'Grupul subcontractorului'),
    desc: L('Alvállalkozó csoportba tétele (group), vagy kivétele a csoportból (group üres / „nincs”).', 'Pune subcontractorul într-un grup sau îl scoate.'),
    examples: L(['tedd a Trans Kft-t a Magyar fuvarozók csoportba'], ['pune Trans SRL în grupul Transportatori HU']),
    params: { carrier: { type: 'carrier', required: true }, group: { type: 'text', max: 120 } },
    async check(ctx, a) {
      a.row = await carrierRow(ctx, a.carrier.id);
      const none = !a.group || /^(nincs|semmi|egyik sem|nici unul|niciunul|fara|fără|none|-)$/i.test(String(a.group).trim());
      if (!none) { const f = await findCarrierGroup(ctx, a.group); if (f.err || f.ask) return f; a.g = f.g; }
      return null;
    },
    async preview(ctx, a) {
      const cur = a.row && a.row.group_id ? ((await q(`SELECT name FROM carrier_groups WHERE id = $1 AND company_id = $2`, [a.row.group_id, ctx.cid]))[0] || {}).name : '';
      return { rows: [['🚚', a.carrier.name], [hu(ctx) ? 'Csoport' : 'Grup', change(cur || '—', a.g ? a.g.name : '—')]], label: a.carrier.name };
    },
    async snapshot(ctx, a) { return { id: a.carrier.id, group_id: a.row ? a.row.group_id : null }; },
    async undo(ctx, b) { return b ? core.callH(H('carriers', 'carrierSetGroup'), ctx.req, [b.id, b.group_id]) : { ok: false }; },
    async run(ctx, a) { const r = await core.callH(H('carriers', 'carrierSetGroup'), ctx.req, [a.carrier.id, a.g ? a.g.id : null]); return r && r.ok ? ok(null, { entity_id: a.carrier.id }) : r; },
  },
  {
    name: 'carrier.vehicle_link', domain: 'carriers', kind: 'write', feature: ['external-drivers', 'carrier-gps'],
    title: L('Alvállalkozói jármű követő-linkje', 'Link urmărire vehicul subcontractor'),
    desc: L('Alvállalkozó járművéhez megosztott GPS-követő link (http/https) beállítása vagy törlése: plate (rendszám), link (üres = törlés). API-kulcsot chatből nem lehet megadni — azt a felületen.', 'Setează linkul de urmărire GPS pentru vehiculul subcontractorului.'),
    params: { plate: { type: 'text', required: true, max: 30 }, link: { type: 'text', max: 1000 }, carrier: { type: 'carrier' } },
    async check(ctx, a) {
      const n = String(a.plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const params = [ctx.cid, n];
      let sql = `SELECT v.id, v.rendszam_camion, v.track_url, c.nev FROM carrier_vehicles v JOIN carriers c ON c.id = v.carrier_id AND c.company_id = v.company_id
                  WHERE v.company_id = $1 AND (REGEXP_REPLACE(UPPER(COALESCE(v.rendszam_camion,'')), '[^A-Z0-9]', '', 'g') = $2
                     OR REGEXP_REPLACE(UPPER(COALESCE(v.rendszam_remorca,'')), '[^A-Z0-9]', '', 'g') = $2)`;
      if (a.carrier) { params.push(a.carrier.id); sql += ' AND v.carrier_id = $3'; }
      const r = await q(sql, params);
      if (!r.length) return { err: (hu(ctx) ? 'Nincs ilyen alvállalkozói jármű: ' : 'Nu există vehiculul subcontractorului: ') + a.plate };
      if (r.length > 1) return { err: hu(ctx) ? 'Több alvállalkozónál is szerepel ez a rendszám — add meg az alvállalkozót is.' : 'Numărul apare la mai mulți subcontractori — precizează subcontractorul.' };
      if (a.link && !/^https?:\/\//i.test(a.link)) return { err: hu(ctx) ? 'A link http:// vagy https:// kezdetű legyen.' : 'Linkul trebuie să înceapă cu http:// sau https://.' };
      a.v = r[0];
      return null;
    },
    async preview(ctx, a) { return { rows: [['🚛', a.v.rendszam_camion + ' · ' + a.v.nev], [hu(ctx) ? 'Követő-link' : 'Link urmărire', change(a.v.track_url || '—', a.link || '—')]], label: a.v.rendszam_camion }; },
    async run(ctx, a) {
      const cur = (await q(`SELECT gps_object_id FROM carrier_vehicles WHERE id = $1 AND company_id = $2`, [a.v.id, ctx.cid]))[0] || {};
      // A meglévő CargoTrack-párosítás (object_id + tárolt kulcs) érintetlen marad.
      const r = await core.callH(H('carriers', 'carrierVehicleSetGps'), ctx.req, [{ id: a.v.id, track_url: a.link || '', gps_object_id: cur.gps_object_id || '', gps_api_key: '' }]);
      return r && r.ok ? ok(null, { entity_id: a.v.id }) : r;
    },
  },
  // ─── Ügyfél törlése ───
  {
    name: 'client.delete', domain: 'clients', kind: 'danger', feature: 'clients', roles: ['Admin'],
    title: L('Ügyfél törlése', 'Ștergere client'),
    desc: L('Ügyfél végleges törlése a listából (a fuvarjai megmaradnak, csak az ügyfél-kapcsolat szűnik meg). Csak Admin.', 'Șterge definitiv un client (cursele rămân).'),
    params: { client: { type: 'client', required: true } },
    async check(ctx, a) {
      const r = await q(`SELECT COUNT(*)::int AS n FROM orders WHERE company_id = $1 AND client_id = $2`, [ctx.cid, a.client.id]);
      a.nOrders = r[0] ? r[0].n : 0;
      return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Ügyfél' : 'Client', a.client.name], [hu(ctx) ? 'Kapcsolódó fuvar' : 'Curse legate', String(a.nOrders) + (a.nOrders ? (hu(ctx) ? ' (megmaradnak)' : ' (rămân)') : '')]], label: a.client.name }; },
    async run(ctx, a) {
      try {
        const done = await require('../../routes/clients').deleteClient(ctx.req, a.client.id);
        return done ? ok(null, { entity_id: a.client.id }) : { ok: false, err: hu(ctx) ? 'Nem található.' : 'Nu a fost găsit.' };
      } catch (e) { console.error('chat client.delete hiba:', e.message); return { ok: false, err: 'Eroare de server' }; }
    },
  },
  // ─── Meghívók ───
  {
    name: 'invite.list', domain: 'drivers', kind: 'read', feature: 'invites',
    desc: L('A kiküldött munkatárs-meghívók listája (kód, név, e-mail, szerep, állapot).', 'Lista invitațiilor trimise.'),
    examples: L(['milyen meghívók vannak kint?'], ['ce invitații sunt trimise?']),
    async run(ctx) {
      const r = await core.callH(H('invites', 'invListAll'), ctx.req, []);
      const rows = Array.isArray(r) ? r : ((r && r.items) || []);
      return { reply: hu(ctx) ? rows.length + ' meghívó.' : rows.length + ' invitații.', html: info(listCard(ctx, '✉️', hu(ctx) ? 'Meghívók' : 'Invitații', rows,
        [{ k: 'kod', l: L('Kód', 'Cod') }, { k: 'nume', l: L('Név', 'Nume') }, { k: 'email', l: L('E-mail', 'E-mail') }, { k: 'pozicio', l: L('Szerep', 'Rol') }, { k: 'status', l: L('Állapot', 'Stare') }], 60)) };
    },
  },
  {
    name: 'invite.revoke', domain: 'drivers', kind: 'write', feature: 'invites',
    title: L('Meghívó visszavonása', 'Retragere invitație'),
    desc: L('Kiküldött meghívó visszavonása: invite = a meghívó kódja vagy a meghívott e-mailje.', 'Retrage o invitație (cod sau e-mail).'),
    params: { invite: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) {
      const s = String(a.invite).trim();
      const r = await q(`SELECT kod, nume, email, pozicio, status FROM invites WHERE company_id = $1 AND (UPPER(kod) = UPPER($2) OR LOWER(email) = LOWER($2)) ORDER BY id DESC LIMIT 1`, [ctx.cid, s]);
      if (!r[0]) return { err: (hu(ctx) ? 'Nincs ilyen meghívó: ' : 'Nu există invitația: ') + s };
      if (r[0].status === 'Visszavonva') return { err: hu(ctx) ? 'Ez a meghívó már vissza van vonva.' : 'Invitația este deja retrasă.' };
      a.inv = r[0];
      return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Kód' : 'Cod', a.inv.kod], [hu(ctx) ? 'Meghívott' : 'Invitat', (a.inv.nume || '') + ' ' + (a.inv.email || '')], [hu(ctx) ? 'Szerep' : 'Rol', a.inv.pozicio]], label: a.inv.kod }; },
    async run(ctx, a) { const r = await core.callH(H('invites', 'invRevoke'), ctx.req, [a.inv.kod]); return r && r.ok !== false ? ok(null, { entity_id: a.inv.kod }) : r; },
  },
  // ─── Portál-belépők ───
  {
    name: 'portal.access_list', domain: 'clients', kind: 'read',
    desc: L('Az ügyfél- és alvállalkozói portál belépőinek listája (e-mail, cég, aktív-e, utolsó belépés).', 'Lista accesurilor în portalul clienților și subcontractorilor.'),
    examples: L(['kik férnek hozzá a portálhoz?'], ['cine are acces în portal?']),
    async run(ctx) {
      const c = await core.callH(H('clientPortal', 'clientPortalList'), ctx.req, []);
      const k = await core.callH(H('carriers', 'carrierPortalList'), ctx.req, []);
      const rows = [].concat(((c && c.items) || []).map((x) => ({ who: hu(ctx) ? 'Ügyfél' : 'Client', org: x.client_nev, email: x.email, activ: x.activ, last: x.last_login })),
        ((k && k.items) || []).map((x) => ({ who: hu(ctx) ? 'Alvállalkozó' : 'Subcontractor', org: x.carrier_nev, email: x.email, activ: x.activ, last: x.last_login })));
      return { reply: hu(ctx) ? rows.length + ' portál-belépő.' : rows.length + ' accesuri portal.', html: info(listCard(ctx, '🔑', hu(ctx) ? 'Portál-belépők' : 'Accesuri portal', rows,
        [{ k: 'who', l: L('Portál', 'Portal') }, { k: 'org', l: L('Cég', 'Firmă') }, { k: 'email', l: L('E-mail', 'E-mail') },
          { k: 'activ', l: L('Állapot', 'Stare'), f: (v) => yes(ctx, v) }, { k: 'last', l: L('Utolsó belépés', 'Ultima logare'), f: (v) => (v ? fmtD(d10(v)) : '—') }], 60)) };
    },
  },
  {
    name: 'portal.access_set', domain: 'clients', kind: 'write',
    title: L('Portál-belépő letiltása / engedélyezése', 'Blocare / activare acces portal'),
    desc: L('Ügyfél- vagy alvállalkozói portál-belépő letiltása vagy visszaengedése: email, active (igen = engedélyez, nem = letilt).', 'Blochează sau reactivează un acces în portal.'),
    examples: L(['tiltsd le a logistica@bilka.ro portál-hozzáférését'], ['blochează accesul în portal pentru logistica@bilka.ro']),
    params: { email: { type: 'email', required: true }, active: { type: 'bool', default: false } },
    async check(ctx, a) {
      const f = await findPortalUser(ctx, a.email); if (f.err) return f;
      a.pu = { kind: f.kind, id: f.u.id, email: f.u.email, org: f.u.org, was: !!f.u.activ };
      a.active = !!a.active;
      if (a.pu.was === a.active) return { err: hu(ctx) ? 'Ez a belépő már ' + yes(ctx, a.active) + '.' : 'Accesul este deja ' + yes(ctx, a.active) + '.' };
      return null;
    },
    async preview(ctx, a) { return { rows: [['🔑', a.pu.email + ' · ' + a.pu.org], [hu(ctx) ? 'Állapot' : 'Stare', change(yes(ctx, a.pu.was), yes(ctx, a.active))]], label: a.pu.email }; },
    async snapshot(ctx, a) { return { kind: a.pu.kind, id: a.pu.id, was: a.pu.was }; },
    async undo(ctx, b) { return b ? core.callH(H(b.kind === 'client' ? 'clientPortal' : 'carriers', b.kind === 'client' ? 'clientPortalSetActive' : 'carrierPortalSetActive'), ctx.req, [b.id, b.was]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H(a.pu.kind === 'client' ? 'clientPortal' : 'carriers', a.pu.kind === 'client' ? 'clientPortalSetActive' : 'carrierPortalSetActive'), ctx.req, [a.pu.id, a.active]);
      return r && r.ok ? ok(null, { entity_id: a.pu.id }) : r;
    },
  },
  // ─── Kedvenc helyszínek ───
  {
    name: 'favloc.list', domain: 'admin', kind: 'read', feature: 'fav-locations',
    desc: L('A mentett kedvenc helyszínek (felrakó/lerakó) listája.', 'Lista locațiilor favorite.'),
    async run(ctx) {
      const r = await core.callH(H('favLocations', 'favLocationList'), ctx.req, []);
      const rows = (r && r.items) || [];
      return { reply: hu(ctx) ? rows.length + ' mentett hely.' : rows.length + ' locații salvate.', html: info(listCard(ctx, '⭐', hu(ctx) ? 'Kedvenc helyszínek' : 'Locații favorite', rows,
        [{ k: 'label', l: L('Név', 'Nume') }, { k: 'address', l: L('Cím', 'Adresă') }, { k: 'type', l: L('Típus', 'Tip') }], 80)) };
    },
  },
  {
    name: 'favloc.delete', domain: 'admin', kind: 'write', feature: 'fav-locations',
    title: L('Kedvenc helyszín törlése', 'Ștergere locație favorită'),
    desc: L('Mentett kedvenc helyszín törlése: place = a hely neve vagy címe.', 'Șterge o locație favorită.'),
    params: { place: { type: 'text', required: true, max: 200 } },
    async check(ctx, a) { const f = await findFavLoc(ctx, a.place); if (f.err || f.ask) return f; a.l = f.l; return null; },
    async preview(ctx, a) { return { rows: [['⭐', a.l.label], [hu(ctx) ? 'Cím' : 'Adresă', a.l.address]], label: a.l.label }; },
    async snapshot(ctx, a) { return { label: a.l.label, address: a.l.address, type: a.l.type }; },
    async undo(ctx, b) { return b ? core.callH(H('favLocations', 'favLocationSave'), ctx.req, [b]) : { ok: false }; },
    async run(ctx, a) { const r = await core.callH(H('favLocations', 'favLocationDelete'), ctx.req, [a.l.id]); return r && r.ok ? ok(null, { entity_id: a.l.id }) : r; },
  },
  // ─── Árajánlat módosítása ───
  {
    name: 'quote.update', domain: 'orders', kind: 'write', feature: 'quotes',
    title: L('Árajánlat módosítása', 'Modificare ofertă'),
    desc: L('Meglévő árajánlat módosítása (a többi adata megmarad): quote (#szám vagy ügyfél neve), from, to, price, currency, valid_until, note.', 'Modifică o ofertă existentă.'),
    examples: L(['a Bilka ajánlatán az ár legyen 1350 euró'], ['la oferta Bilka prețul să fie 1350 euro']),
    params: { quote: { type: 'text', required: true, max: 120 }, from: { type: 'text', max: 200 }, to: { type: 'text', max: 200 }, price: { type: 'money', min: 0, maxv: 1e7 },
      currency: { type: 'enum', values: ['EUR', 'RON', 'HUF', 'PLN', 'USD'] }, valid_until: { type: 'date' }, note: { type: 'text', max: 1000 } },
    async check(ctx, a) {
      const f = await findQuote(ctx, a.quote); if (f.err || f.ask) return f;
      if (!['from', 'to', 'price', 'currency', 'valid_until', 'note'].some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Mit módosítsak az ajánlaton?' : 'Ce modific la ofertă?', options: [] } };
      a.qt = f.qt;
      return null;
    },
    async preview(ctx, a) {
      const x = a.qt; const rows = [['#', '#' + x.id + ' · ' + (x.client_name || '')]];
      if (a.from != null) rows.push([hu(ctx) ? 'Honnan' : 'De la', change(x.loc_from, a.from)]);
      if (a.to != null) rows.push([hu(ctx) ? 'Hová' : 'Până la', change(x.loc_to, a.to)]);
      if (a.price != null) rows.push([hu(ctx) ? 'Ár' : 'Preț', change(x.price, a.price)]);
      if (a.currency != null) rows.push([hu(ctx) ? 'Pénznem' : 'Monedă', change(x.valuta, a.currency)]);
      if (a.valid_until != null) rows.push([hu(ctx) ? 'Érvényes' : 'Valabilă', change(x.valid_until ? fmtD(d10(x.valid_until)) : '', fmtD(a.valid_until))]);
      if (a.note != null) rows.push([hu(ctx) ? 'Megjegyzés' : 'Notă', change(x.note, a.note)]);
      return { rows, label: '#' + x.id };
    },
    async snapshot(ctx, a) { return { q: a.qt }; },
    async undo(ctx, b) {
      const x = b && b.q; if (!x) return { ok: false };
      return core.callH(H('quotes', 'quoteSave'), ctx.req, [{ id: x.id, client_id: x.client_id, client_name: x.client_name, loc_from: x.loc_from, loc_to: x.loc_to, price: x.price, valuta: x.valuta, valid_until: d10(x.valid_until) || null, note: x.note }]);
    },
    async run(ctx, a) {
      const x = a.qt;
      const r = await core.callH(H('quotes', 'quoteSave'), ctx.req, [{ id: x.id, client_id: x.client_id, client_name: x.client_name,
        loc_from: a.from != null ? a.from : x.loc_from, loc_to: a.to != null ? a.to : x.loc_to, price: a.price != null ? a.price : x.price,
        valuta: a.currency || x.valuta, valid_until: a.valid_until || d10(x.valid_until) || null, note: a.note != null ? a.note : x.note }]);
      return r && r.ok ? ok(null, { entity_id: x.id }) : r;
    },
  },
  // ─── Tranzakciós e-mail sablonok ───
  {
    name: 'mail.template_list', domain: 'mail', kind: 'read', feature: 'email-templates',
    desc: L('A cég tranzakciós e-mail sablonjai (fuvar-visszaigazolás, státusz-változás, árajánlat, számla-értesítő, általános) és a tárgyuk.', 'Șabloanele de e-mail tranzacționale ale firmei.'),
    async run(ctx) {
      const r = await core.callH(H('emailTemplates', 'emailTemplateList'), ctx.req, []);
      const rows = ((r && r.items) || []).map((t) => ({ name: tplName(ctx, t.key), subject: hu(ctx) ? (t.subject_hu || t.subject_ro) : (t.subject_ro || t.subject_hu), active: t.active !== false, own: !t.isDefault }));
      return { reply: hu(ctx) ? 'A sablonok. Küldéshez írd pl.: „küldd el a számla-értesítőt a Bilkának".' : 'Șabloanele. Pentru trimitere scrie ex.: „trimite notificarea de factură către Bilka".',
        html: info(listCard(ctx, '✉️', hu(ctx) ? 'E-mail sablonok' : 'Șabloane e-mail', rows,
          [{ k: 'name', l: L('Sablon', 'Șablon') }, { k: 'subject', l: L('Tárgy', 'Subiect') }, { k: 'active', l: L('Állapot', 'Stare'), f: (v) => yes(ctx, v) },
            { k: 'own', l: L('Saját', 'Propriu'), f: (v) => (v ? '✓' : (hu(ctx) ? 'alap' : 'implicit')) }])) };
    },
  },
  {
    name: 'mail.template_send', domain: 'mail', kind: 'write', feature: 'email-templates',
    title: L('E-mail küldése sablonból', 'Trimitere e-mail din șablon'),
    desc: L('E-mail küldése a cég tranzakciós sablonjából a cég saját feladó-fiókjáról: template (' + TPL_KEYS.join('|') + '), to (e-mail cím vagy ügyfél neve), order (opcionális fuvarszám — kitölti a fuvar-adatokat), invoice_no, price, subject, message (a generic sablonhoz), lang (ro|hu).', 'Trimite un e-mail din șablonul firmei.'),
    examples: L(['küldd el a számla-értesítőt a Bilkának az FCT-123 számláról'], ['trimite notificarea de factură FCT-123 către Bilka']),
    params: { template: { type: 'enum', values: TPL_KEYS, required: true }, to: { type: 'text', required: true, max: 200 }, order: { type: 'order' },
      invoice_no: { type: 'text', max: 60 }, price: { type: 'text', max: 60 }, subject: { type: 'text', max: 200 }, message: { type: 'text', max: 2000 }, lang: { type: 'enum', values: ['ro', 'hu'], default: 'ro' } },
    async check(ctx, a) {
      const s = String(a.to).trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) a.toEmail = s.toLowerCase();
      else {
        const c = await require('../chatOps')._findClient(ctx.cid, s);
        if (c && c.ambiguous) return { ask: { text: hu(ctx) ? 'Melyik ügyfél?' : 'Care client?', options: c.ambiguous.map((n) => ctx.retext(n, s)) } };
        const em = c ? ((await q(`SELECT email FROM clients WHERE id = $1 AND company_id = $2`, [c.id, ctx.cid]))[0] || {}).email : null;
        if (!em) return { err: hu(ctx) ? 'Nem találom a címzett e-mail címét — írd be a címet.' : 'Nu găsesc adresa de e-mail — scrie adresa.' };
        a.toEmail = String(em).toLowerCase(); a.toName = c.denumire;
      }
      const vars = { client: a.toName || '', invoice_no: a.invoice_no || '', pret: a.price || '', subject: a.subject || '', message: a.message || '' };
      if (a.order) {
        const o = (await q(`SELECT id, fuvar_no, client, loc_incarcare, loc_descarcare, status, pret, valuta FROM orders WHERE id = $1 AND company_id = $2`, [a.order.id, ctx.cid]))[0];
        if (o) {
          vars.order_id = o.fuvar_no || o.id; vars.route = [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '); vars.status = o.status || '';
          if (!vars.client) vars.client = o.client || '';
          if (!vars.pret && o.pret) vars.pret = fmtN(num(o.pret), 2) + ' ' + (o.valuta || 'EUR');
        }
      }
      if (a.template === 'generic' && !a.message) return { ask: { text: hu(ctx) ? 'Mi legyen a levél szövege?' : 'Care să fie textul mesajului?', options: [] } };
      a.vars = vars;
      return null;
    },
    async preview(ctx, a) {
      const rows = [[hu(ctx) ? 'Sablon' : 'Șablon', tplName(ctx, a.template)], [hu(ctx) ? 'Címzett' : 'Destinatar', (a.toName ? a.toName + ' · ' : '') + a.toEmail], [hu(ctx) ? 'Nyelv' : 'Limba', a.lang.toUpperCase()]];
      if (a.vars.order_id) rows.push([hu(ctx) ? 'Fuvar' : 'Cursa', a.vars.order_id + (a.vars.route ? ' · ' + a.vars.route : '')]);
      if (a.invoice_no) rows.push([hu(ctx) ? 'Számla' : 'Factură', a.invoice_no]);
      if (a.vars.pret) rows.push([hu(ctx) ? 'Ár' : 'Preț', a.vars.pret]);
      if (a.message) rows.push([hu(ctx) ? 'Szöveg' : 'Text', a.message]);
      return { rows, label: a.toEmail };
    },
    async run(ctx, a) {
      const r = await core.callH(H('emailTemplates', 'sendTemplatedEmail'), ctx.req, [{ template_key: a.template, to_email: a.toEmail, lang: a.lang, vars: a.vars }]);
      return r && r.ok ? ok((hu(ctx) ? '✅ Elküldve: ' : '✅ Trimis: ') + a.toEmail) : r;
    },
  },
  {
    name: 'mail.template_edit', domain: 'mail', kind: 'write', feature: 'email-templates',
    title: L('E-mail sablon módosítása', 'Modificare șablon e-mail'),
    desc: L('Tranzakciós e-mail sablon tárgyának / szövegének módosítása, vagy be-/kikapcsolása: template (' + TPL_KEYS.join('|') + '), lang (ro|hu), subject, body (sima szöveg; a {{order_id}}, {{route}}, {{client}}, {{pret}}, {{invoice_no}}, {{status}} változók használhatók), active.', 'Modifică subiectul / textul unui șablon de e-mail.'),
    params: { template: { type: 'enum', values: TPL_KEYS, required: true }, lang: { type: 'enum', values: ['ro', 'hu'], default: 'ro' }, subject: { type: 'text', max: 500 }, body: { type: 'text', max: 5000 }, active: { type: 'bool' } },
    async check(ctx, a) {
      if (a.subject == null && a.body == null && a.active == null) return { ask: { text: hu(ctx) ? 'Mit módosítsak a sablonon (tárgy, szöveg)?' : 'Ce modific la șablon (subiect, text)?', options: [] } };
      const r = await core.callH(H('emailTemplates', 'emailTemplateList'), ctx.req, []);
      a.cur = ((r && r.items) || []).find((t) => t.key === a.template);
      if (!a.cur) return { err: hu(ctx) ? 'Nincs ilyen sablon.' : 'Nu există șablonul.' };
      return null;
    },
    async preview(ctx, a) {
      const c = a.cur; const sk = 'subject_' + a.lang; const bk = 'body_' + a.lang;
      const rows = [[hu(ctx) ? 'Sablon' : 'Șablon', tplName(ctx, a.template) + ' (' + a.lang.toUpperCase() + ')']];
      if (a.subject != null) rows.push([hu(ctx) ? 'Tárgy' : 'Subiect', change(c[sk], a.subject)]);
      if (a.body != null) rows.push([hu(ctx) ? 'Szöveg' : 'Text', change(String(c[bk] || '').replace(/<[^>]+>/g, ' ').trim(), a.body)]);
      if (a.active != null) rows.push([hu(ctx) ? 'Állapot' : 'Stare', change(yes(ctx, c.active !== false), yes(ctx, a.active))]);
      return { rows, label: tplName(ctx, a.template) };
    },
    async snapshot(ctx, a) { return { t: a.cur }; },
    async undo(ctx, b) { const t = b && b.t; return t ? core.callH(H('emailTemplates', 'emailTemplateSave'), ctx.req, [{ key: t.key, subject_ro: t.subject_ro, subject_hu: t.subject_hu, body_ro: t.body_ro, body_hu: t.body_hu, active: t.active !== false }]) : { ok: false }; },
    async run(ctx, a) {
      const c = a.cur; const out = { key: c.key, subject_ro: c.subject_ro, subject_hu: c.subject_hu, body_ro: c.body_ro, body_hu: c.body_hu, active: a.active != null ? a.active : c.active !== false };
      if (a.subject != null) out['subject_' + a.lang] = a.subject;
      // A szöveget biztonságos HTML-be tesszük (escape + bekezdések); a {{változók}} megmaradnak.
      if (a.body != null) out['body_' + a.lang] = String(a.body).split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
      const r = await core.callH(H('emailTemplates', 'emailTemplateSave'), ctx.req, [out]);
      return r && r.ok ? ok(null) : r;
    },
  },
  {
    name: 'mail.log', domain: 'mail', kind: 'read', feature: 'mail-log',
    desc: L('A cégtől kiküldött e-mailek naplója (címzett, tárgy, állapot, időpont), opcionális időszakkal.', 'Jurnalul e-mailurilor trimise.'),
    examples: L(['milyen leveleket küldtünk ki a héten?'], ['ce e-mailuri am trimis săptămâna asta?']),
    params: { period: { type: 'period' } },
    async run(ctx, a) {
      const r = await core.callH(H('mailLog', 'mailLogList'), ctx.req, [{ from: a.period ? a.period.from : null, to: a.period ? a.period.to : null }]);
      const rows = (r && r.items) || [];
      return { reply: hu(ctx) ? rows.length + ' kiküldött levél.' : rows.length + ' e-mailuri trimise.', html: info(listCard(ctx, '📨', hu(ctx) ? 'Kiküldött levelek' : 'E-mailuri trimise', rows,
        [{ k: 'created_at', l: L('Időpont', 'Data'), f: (v) => fmtD(d10(v)) }, { k: 'to_email', l: L('Címzett', 'Destinatar') }, { k: 'subject', l: L('Tárgy', 'Subiect') }, { k: 'status', l: L('Állapot', 'Stare') }], 60)) };
    },
  },
  // ─── Költség-kalkulátor: költségtételek ───
  {
    name: 'vcalc.cost_add', domain: 'finance', kind: 'write', feature: ['vcalc-vehicle-costs', 'vcalc-driver-costs', 'vcalc-company-costs'],
    title: L('Költségtétel (kalkulátor)', 'Element de cost (calculator)'),
    desc: L('Költségtétel felvétele a költség-kalkulátorba: scope (vehicle|driver|company), vehicle (rendszám, ha vehicle), driver (ha driver), name, amount (lej), basis (time|km), interval_months (time-hoz), interval_km (km-hez), gross (bruttó-e, alap: igen).', 'Adaugă un element de cost în calculator.'),
    examples: L(['vegyél fel a vontatóra 4500 lej gumicserét 120000 km-enként'], ['adaugă la camion schimb anvelope 4500 lei la 120000 km']),
    params: { scope: { type: 'enum', values: ['vehicle', 'driver', 'company'], required: true }, vehicle: { type: 'vehicle' }, driver: { type: 'driver' }, name: { type: 'text', required: true, max: 200 },
      amount: { type: 'money', required: true, min: 0, maxv: 1e8 }, basis: { type: 'enum', values: ['time', 'km'], default: 'time' }, interval_months: { type: 'int', min: 1, maxv: 120 },
      interval_km: { type: 'int', min: 1, maxv: 5000000 }, gross: { type: 'bool', default: true } },
    async check(ctx, a) {
      if (a.scope === 'vehicle' && !a.vehicle) return { ask: { text: hu(ctx) ? 'Melyik járműhöz?' : 'La ce vehicul?', options: [] } };
      if (a.scope === 'driver' && !a.driver) return { ask: { text: hu(ctx) ? 'Melyik sofőrhöz?' : 'La ce șofer?', options: [] } };
      if (a.scope === 'driver') { a.driverId = await driverId(ctx, a.driver.email); if (!a.driverId) return { err: hu(ctx) ? 'Nem találom a sofőrt.' : 'Nu găsesc șoferul.' }; }
      if (a.basis === 'km' && !a.interval_km) return { ask: { text: hu(ctx) ? 'Hány km-enként?' : 'La câți km?', options: [] } };
      if (a.basis === 'time' && !a.interval_months) a.interval_months = 12;
      return null;
    },
    async preview(ctx, a) {
      const sc = { vehicle: L('Jármű', 'Vehicul'), driver: L('Sofőr', 'Șofer'), company: L('Cég', 'Firmă') }[a.scope];
      return { rows: [[hu(ctx) ? 'Hova' : 'Unde', (sc[ctx.lang] || sc.hu) + (a.vehicle ? ' · ' + a.vehicle.plate : a.driver ? ' · ' + a.driver.name : '')], [hu(ctx) ? 'Tétel' : 'Element', a.name],
        [hu(ctx) ? 'Összeg' : 'Sumă', fmtN(a.amount, 2) + ' lei' + (a.gross ? (hu(ctx) ? ' (bruttó)' : ' (brut)') : (hu(ctx) ? ' (nettó)' : ' (net)'))],
        [hu(ctx) ? 'Gyakoriság' : 'Frecvență', a.basis === 'km' ? fmtN(a.interval_km) + ' km' : a.interval_months + (hu(ctx) ? ' hónap' : ' luni')]], label: a.name };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) {
      if (!res || !res.id || !res.scope) return { ok: false };
      const fn = { vehicle: 'vcalcVehicleCostDelete', driver: 'vcalcDriverCostDelete', company: 'vcalcCompanyCostDelete' }[res.scope];
      return core.callH(H('costCalculator', fn), ctx.req, [{ id: res.id }]);
    },
    async run(ctx, a) {
      const base = { name: a.name, amount_lei: a.amount, is_gross: a.gross !== false };
      let r;
      if (a.scope === 'vehicle') r = await core.callH(H('costCalculator', 'vcalcVehicleCostSave'), ctx.req, [Object.assign(base, { vehicle_id: a.vehicle.id, basis_type: a.basis, interval_km: a.interval_km, interval_months: a.interval_months })]);
      else if (a.scope === 'driver') r = await core.callH(H('costCalculator', 'vcalcDriverCostSave'), ctx.req, [Object.assign(base, { driver_id: a.driverId })]);
      else r = await core.callH(H('costCalculator', 'vcalcCompanyCostSave'), ctx.req, [Object.assign(base, { basis_type: 'time', interval_months: a.interval_months || 12 })]);
      return r && r.ok ? ok(null, { id: r.id, scope: a.scope, entity_id: r.id || null }) : r;
    },
  },
  // ─── Fuvar-sorozatok ───
  {
    name: 'order_series.list', domain: 'settings', kind: 'read',
    desc: L('A fuvar-szám sorozatok (előtagok, pl. CMD) és melyik az alapértelmezett.', 'Seriile de numerotare a curselor.'),
    async run(ctx) {
      const r = await core.callH(H('orderSeries', 'orderSeriesList'), ctx.req, []);
      const rows = (r && r.series) || [];
      return { reply: hu(ctx) ? rows.length + ' sorozat.' : rows.length + ' serii.', html: info(listCard(ctx, '🔢', hu(ctx) ? 'Fuvar-sorozatok' : 'Serii curse', rows,
        [{ k: 'prefix', l: L('Előtag', 'Prefix') }, { k: 'is_default', l: L('Alapértelmezett', 'Implicită'), f: (v) => (v ? '⭐' : '') }, { k: 'last_no', l: L('Utolsó szám', 'Ultimul nr.'), f: (v) => (v != null ? String(v) : '—') }])) };
    },
  },
  {
    name: 'order_series.save', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Fuvar-sorozat', 'Serie curse'),
    desc: L('Új fuvar-szám sorozat (prefix, 1–10 betű/szám), vagy meglévő átnevezése (series = régi előtag); make_default = legyen alapértelmezett. Csak Admin.', 'Creează sau redenumește o serie de curse.'),
    examples: L(['vegyél fel egy EXP fuvar-sorozatot és legyen alapértelmezett'], ['adaugă seria EXP și fă-o implicită']),
    params: { prefix: { type: 'text', required: true, max: 10 }, series: { type: 'text', max: 10 }, make_default: { type: 'bool', default: false } },
    async check(ctx, a) {
      a.prefix = String(a.prefix).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!a.prefix) return { err: hu(ctx) ? 'Az előtag csak betű/szám lehet.' : 'Prefixul poate conține doar litere/cifre.' };
      if (a.series) {
        const r = await q(`SELECT id, prefix FROM order_series WHERE company_id = $1 AND UPPER(prefix) = UPPER($2)`, [ctx.cid, a.series]);
        if (!r[0]) return { err: (hu(ctx) ? 'Nincs ilyen sorozat: ' : 'Nu există seria: ') + a.series };
        a.s = r[0];
      }
      return null;
    },
    async preview(ctx, a) {
      const rows = [a.s ? [hu(ctx) ? 'Sorozat' : 'Serie', change(a.s.prefix, a.prefix)] : [hu(ctx) ? 'Új sorozat' : 'Serie nouă', a.prefix + '-ÉÉÉÉ-0001'.replace('ÉÉÉÉ', String(ctx.now.getFullYear()))]];
      if (a.make_default) rows.push([hu(ctx) ? 'Alapértelmezett' : 'Implicită', '⭐']);
      return { rows, label: a.prefix };
    },
    async run(ctx, a) { const r = await core.callH(H('orderSeries', 'orderSeriesSave'), ctx.req, [{ id: a.s ? a.s.id : null, prefix: a.prefix, makeDefault: !!a.make_default }]); return r && r.ok ? ok(null, { entity_id: r.id }) : r; },
  },
  {
    name: 'order_series.set_default', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Alapértelmezett fuvar-sorozat', 'Serie implicită'),
    desc: L('Melyik fuvar-sorozat legyen az alapértelmezett: series (előtag). Csak Admin.', 'Setează seria implicită.'),
    params: { series: { type: 'text', required: true, max: 10 } },
    async check(ctx, a) {
      const r = await q(`SELECT id, prefix FROM order_series WHERE company_id = $1 AND UPPER(prefix) = UPPER($2)`, [ctx.cid, a.series]);
      if (!r[0]) return { err: (hu(ctx) ? 'Nincs ilyen sorozat: ' : 'Nu există seria: ') + a.series };
      a.s = r[0];
      a.prev = ((await q(`SELECT id FROM order_series WHERE company_id = $1 AND is_default = true LIMIT 1`, [ctx.cid]))[0] || {}).id || null;
      return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Alapértelmezett' : 'Implicită', '⭐ ' + a.s.prefix]], label: a.s.prefix }; },
    async snapshot(ctx, a) { return { id: a.prev }; },
    async undo(ctx, b) { return b && b.id ? core.callH(H('orderSeries', 'orderSeriesSetDefault'), ctx.req, [{ id: b.id }]) : { ok: false }; },
    async run(ctx, a) { const r = await core.callH(H('orderSeries', 'orderSeriesSetDefault'), ctx.req, [{ id: a.s.id }]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Útdíj-ráták ───
  {
    name: 'toll.rates', domain: 'orders', kind: 'read', feature: 'toll-becsles',
    desc: L('Az útdíj-becslés országonkénti rátái (€/km vagy matrica €/fuvar).', 'Tarifele de taxe de drum pe țări.'),
    async run(ctx) {
      const r = await core.callH(H('toll', 'getTollRates'), ctx.req, []);
      const rows = (r && r.rates) || [];
      return { reply: hu(ctx) ? 'Az útdíj-ráták.' : 'Tarifele de drum.', html: info(listCard(ctx, '🛣️', hu(ctx) ? 'Útdíj-ráták' : 'Tarife drum', rows,
        [{ k: 'name', l: L('Ország', 'Țară') }, { k: 'mode', l: L('Mód', 'Mod'), f: (v) => (v === 'vignette' ? (hu(ctx) ? 'matrica' : 'vinietă') : '€/km') },
          { k: 'eur_per_km', l: L('€/km', '€/km') }, { k: 'vignette_eur', l: L('Matrica €', 'Vinietă €') }, { k: 'custom', l: L('Saját', 'Propriu'), f: (v) => (v ? '✓' : '') }], 60)) };
    },
  },
  {
    name: 'toll.rate_set', domain: 'orders', kind: 'write', feature: 'toll-becsles',
    title: L('Útdíj-ráta', 'Tarif drum'),
    desc: L('Egy ország útdíj-rátájának beállítása: country (2 betűs kód, pl. HU, AT), mode (perkm|vignette), eur_per_km, vignette_eur.', 'Setează tariful de drum pentru o țară.'),
    examples: L(['Ausztriában az útdíj legyen 0,45 €/km'], ['în Austria taxa să fie 0,45 €/km']),
    params: { country: { type: 'text', required: true, max: 2 }, mode: { type: 'enum', values: ['perkm', 'vignette'] }, eur_per_km: { type: 'number', min: 0, maxv: 10 }, vignette_eur: { type: 'number', min: 0, maxv: 10000 } },
    async check(ctx, a) {
      a.country = String(a.country).toUpperCase();
      if (!/^[A-Z]{2}$/.test(a.country)) return { err: hu(ctx) ? 'Az ország 2 betűs kód legyen (pl. HU).' : 'Țara trebuie să fie un cod de 2 litere (ex. HU).' };
      if (a.eur_per_km == null && a.vignette_eur == null && a.mode == null) return { ask: { text: hu(ctx) ? 'Mennyi legyen a ráta?' : 'Care să fie tariful?', options: [] } };
      const r = await core.callH(H('toll', 'getTollRates'), ctx.req, []);
      a.cur = ((r && r.rates) || []).find((x) => x.cc === a.country) || { cc: a.country, name: a.country, mode: 'perkm', eur_per_km: 0, vignette_eur: 0 };
      if (!a.mode) a.mode = a.vignette_eur != null && a.eur_per_km == null ? 'vignette' : (a.eur_per_km != null ? 'perkm' : a.cur.mode);
      return null;
    },
    async preview(ctx, a) {
      const c = a.cur;
      return { rows: [[hu(ctx) ? 'Ország' : 'Țară', c.name], [hu(ctx) ? 'Mód' : 'Mod', change(c.mode, a.mode)],
        ['€/km', change(c.eur_per_km, a.eur_per_km != null ? a.eur_per_km : c.eur_per_km)], [hu(ctx) ? 'Matrica €' : 'Vinietă €', change(c.vignette_eur, a.vignette_eur != null ? a.vignette_eur : c.vignette_eur)]], label: c.name };
    },
    async snapshot(ctx, a) { return { r: a.cur }; },
    async undo(ctx, b) { const c = b && b.r; return c ? core.callH(H('toll', 'saveTollRates'), ctx.req, [[{ cc: c.cc, mode: c.mode, eur_per_km: c.eur_per_km, vignette_eur: c.vignette_eur }]]) : { ok: false }; },
    async run(ctx, a) {
      const c = a.cur;
      const r = await core.callH(H('toll', 'saveTollRates'), ctx.req, [[{ cc: a.country, mode: a.mode, eur_per_km: a.eur_per_km != null ? a.eur_per_km : c.eur_per_km, vignette_eur: a.vignette_eur != null ? a.vignette_eur : c.vignette_eur }]]);
      return r && r.ok ? ok(null) : r;
    },
  },
  // ─── Tanult adatok ───
  {
    name: 'learned.list', domain: 'admin', kind: 'read', feature: 'learned-data',
    desc: L('Mit tanult meg a rendszer (cím-párok, ügyfél-áruk, sofőr-becenevek, levél-beállítások, megrendelés-minták, chat-mondatok) — fajtánként darabszám.', 'Ce a învățat sistemul — pe tipuri.'),
    async run(ctx) {
      const r = await core.callH(H('learnedData', 'learnedDataList'), ctx.req, []);
      if (!r || !r.ok) return r;
      const cnt = {};
      (r.memory || []).forEach((m) => { cnt[m.kind] = (cnt[m.kind] || 0) + 1; });
      const rows = MEM_KINDS.map((k) => ({ kind: k, n: cnt[k] || 0 })).concat([{ kind: 'order_scan', n: (r.orderScan || []).length }, { kind: 'chat_miss', n: (r.chatMiss || []).length }, { kind: 'chat_intent', n: (r.chatIntent || []).length }]);
      return { reply: hu(ctx) ? 'A tanult adatok fajtánként. Törléshez: „felejtsd el a sofőr-beceneveket” (driver_alias).' : 'Datele învățate pe tipuri. Pentru ștergere: „uită poreclele șoferilor” (driver_alias).',
        html: info(listCard(ctx, '🧠', hu(ctx) ? 'Tanult adatok' : 'Date învățate', rows, [{ k: 'kind', l: L('Fajta', 'Tip') }, { k: 'n', l: L('Darab', 'Bucăți') }])) };
    },
  },
  {
    name: 'learned.forget', domain: 'admin', kind: 'danger', feature: 'learned-data',
    title: L('Tanult adatok törlése', 'Ștergere date învățate'),
    desc: L('Egy fajta tanult adat teljes törlése: kind (' + LEARN_KINDS.join('|') + '). Az order_scan egy megbízó-minta törléséhez a felületet használd.', 'Șterge toate datele învățate de un tip.'),
    params: { kind: { type: 'enum', values: LEARN_KINDS, required: true } },
    async check(ctx, a) { if (a.kind === 'order_scan') return { err: hu(ctx) ? 'A megrendelés-mintákat egyenként a Tanult adatok oldalon törölheted.' : 'Șabloanele de comenzi se șterg individual pe pagina Date învățate.' }; return null; },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Fajta' : 'Tip', a.kind], [hu(ctx) ? 'Hatás' : 'Efect', hu(ctx) ? 'mind törlődik' : 'se șterg toate']], label: a.kind }; },
    async run(ctx, a) {
      const src = MEM_KINDS.includes(a.kind) ? 'memory' : a.kind;
      const r = await core.callH(H('learnedData', 'learnedDataDelete'), ctx.req, [{ source: src, kind: a.kind }]);
      return r && r.ok ? ok(null) : r;
    },
  },
];
