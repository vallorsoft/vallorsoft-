// ============================================================
//  VallorSoft — lib/chatTools/fleet.js
//  🛻 Flotta-képességek: járművek, párosítás, élő pozíció, lejáratok,
//  szerviz, üzemanyagkártya. Írás a meglévő handlereken (fleet.js,
//  fleetCompliance.js).
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');

const { esc, fmtN, fmtD, num } = core.fmt;
const { change, listCard, kvCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const hu = (ctx) => ctx.lang === 'hu';

// Lejárat-típusok: kulcs → felirat (a felület is a feliratot tárolja a doc_type-ban).
const DOC = {
  itp: L('ITP (műszaki)', 'ITP (tehnică)'), rca: L('RCA (kötelező bizt.)', 'RCA (asig. obligatorie)'), casco: L('CASCO', 'CASCO'),
  rovinieta: L('Rovinietă', 'Rovinietă'), cmr_insurance: L('CMR-biztosítás', 'Asigurare CMR'), tacho_calibration: L('Tahográf-hitelesítés', 'Verificare tahograf'),
  tacho_card: L('Tahográf-kártya', 'Card tahograf'), tacho_download: L('Tahográf-letöltés (28 nap)', 'Descărcare tahograf (28 zile)'),
  adr: L('ADR-engedély', 'Autorizație ADR'), community_license: L('Közösségi engedély', 'Licență comunitară'), copie_conforma: L('Közösségi eng. másolat (copie conformă)', 'Copie conformă'),
  driving_license: L('Jogosítvány', 'Permis de conducere'), atestat: L('Atestat (szakmai)', 'Atestat (profesional)'), medical: L('Orvosi/pszichológiai', 'Medical/psihologic'), other: L('Egyéb', 'Altele'),
};
const SVC_CATS = ['olajcsere', 'gumi', 'javitas', 'karbantartas', 'egyeb'];
const SVC_ITEMS = ['oil', 'oil_filter', 'fuel_filter', 'air_filter', 'pollen_filter', 'adblue_filter', 'air_dryer_filter', 'brake_pads', 'brake_disc', 'coolant', 'transmission_oil', 'differential_oil', 'tires', 'wipers', 'battery', 'timing_belt', 'other'];

// A jármű legutóbbi NYITOTT, esedékességgel bíró szerviz-sora (halasztás / elvégezve).
async function openService(cid, vehicleId) {
  const r = await q(`SELECT id, service_date, km, description, next_due_date, next_due_km FROM vehicle_service_log
                      WHERE company_id = $1 AND vehicle_id = $2 AND closed_at IS NULL AND (next_due_date IS NOT NULL OR next_due_km IS NOT NULL)
                      ORDER BY service_date DESC, id DESC LIMIT 1`, [cid, vehicleId]);
  return r[0] || null;
}

module.exports = [
  {
    name: 'vehicle.list', domain: 'fleet', kind: 'read', feature: 'vehicles',
    desc: L('Járművek listája (kind: tractor|trailer|all), sofőr-párosítással.', 'Lista vehiculelor, cu șoferul alocat.'),
    params: { kind: { type: 'enum', values: ['tractor', 'trailer', 'all'], default: 'all' } },
    async run(ctx, a) {
      const w = a.kind === 'tractor' ? `AND v.tip = 'Vontato'` : a.kind === 'trailer' ? `AND v.tip = 'Potkocsi'` : '';
      const rows = await q(`SELECT v.id, v.rendszam, v.tip, v.marca, v.model, v.activ, u.nume AS sofer, t.rendszam AS potkocsi
                              FROM vehicles v LEFT JOIN users u ON LOWER(u.email) = LOWER(v.assigned_driver_email) AND u.company_id = v.company_id
                              LEFT JOIN vehicles t ON t.id = v.default_trailer_id AND t.company_id = v.company_id
                             WHERE v.company_id = $1 ${w} ORDER BY v.tip, v.rendszam LIMIT 300`, [ctx.cid]);
      return { reply: hu(ctx) ? rows.length + ' jármű.' : rows.length + ' vehicule.', html: '<div class="och-info">' + listCard(ctx, '🛻', hu(ctx) ? 'Járművek' : 'Vehicule', rows, [
        { k: 'rendszam', l: L('Rendszám', 'Nr.'), f: (v, r) => ({ __html: '<a href="#" onclick="OrderChat.runUi({op:\'vehicle\',id:\'' + esc(r.id) + '\'});return false;">' + esc(v) + '</a>' }) },
        { k: 'tip', l: L('Típus', 'Tip'), f: (v) => (v === 'Vontato' ? (hu(ctx) ? 'Vontató' : 'Camion') : (hu(ctx) ? 'Pótkocsi' : 'Remorcă')) },
        { k: 'marca', l: L('Márka', 'Marcă'), f: (v, r) => [v, r.model].filter(Boolean).join(' ') },
        { k: 'sofer', l: L('Sofőr', 'Șofer') }, { k: 'potkocsi', l: L('Alap pótkocsi', 'Remorcă implicită') },
        { k: 'activ', l: L('Aktív', 'Activ'), f: (v) => (v === false ? '—' : '✓') }], 60) + '</div>' };
    },
  },
  {
    name: 'vehicle.position', domain: 'fleet', kind: 'read', feature: 'gps-integracio',
    desc: L('Egy jármű élő GPS-pozíciója (hol van, sebesség, utolsó jel).', 'Poziția GPS live a unui vehicul.'),
    examples: L(['hol van a B123ABC?'], ['unde e B123ABC?']),
    params: { vehicle: { type: 'vehicle', required: true } },
    async run(ctx, a) {
      const p = await di._h.livePos(ctx.cid, a.vehicle.plate);
      if (!p) return { reply: hu(ctx) ? 'Ehhez a járműhöz nincs élő GPS-adat.' : 'Nu există date GPS live pentru acest vehicul.', html: '' };
      const place = await di._h.placeOf(p.lat, p.lng, ctx.lang);
      const map = 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=12/' + p.lat + '/' + p.lng;
      return { reply: (hu(ctx) ? a.vehicle.plate + ' most: ' : a.vehicle.plate + ' acum: ') + (place || (p.lat.toFixed(4) + ', ' + p.lng.toFixed(4))), html: '<div class="och-info">' + kvCard('📍', a.vehicle.plate, [
        [hu(ctx) ? 'Hely' : 'Loc', place || '—'], [hu(ctx) ? 'Sebesség' : 'Viteză', p.speed != null ? Math.round(p.speed) + ' km/h' : '—'],
        [hu(ctx) ? 'Utolsó jel' : 'Ultimul semnal', p.datetime ? String(p.datetime).replace('T', ' ').slice(0, 16) : '—'],
        [hu(ctx) ? 'Tank' : 'Rezervor', p.fuel_level != null ? fmtN(p.fuel_level, 0) : '—'],
        ['🗺️', { __html: '<a href="' + esc(map) + '" target="_blank" rel="noopener">' + (hu(ctx) ? 'Térkép' : 'Hartă') + '</a>' }]]) + '</div>' };
    },
  },
  {
    name: 'vehicle.open', domain: 'fleet', kind: 'ui', feature: 'vehicles',
    desc: L('Jármű adatlapjának megnyitása (lejáratok, szerviz, tankolások).', 'Deschide fișa vehiculului.'),
    params: { vehicle: { type: 'vehicle', required: true } },
    async run(ctx, a) { return { reply: core.tx(ctx.lang).opened(a.vehicle.plate), ui: { op: 'vehicle', id: String(a.vehicle.id) } }; },
  },
  {
    name: 'vehicle.create', domain: 'fleet', kind: 'write', feature: 'vehicles',
    title: L('Új jármű', 'Vehicul nou'),
    desc: L('Új jármű felvétele: plate (rendszám), kind (tractor|trailer), brand, model, year.', 'Adaugă vehicul nou.'),
    examples: L(['vegyél fel egy új vontatót B123ABC Mercedes Actros 2021'], ['adaugă camion nou B123ABC Volvo FH 2020']),
    params: { plate: { type: 'text', required: true, max: 20 }, kind: { type: 'enum', values: ['tractor', 'trailer'], required: true }, brand: { type: 'text', max: 60 }, model: { type: 'text', max: 60 }, year: { type: 'int', min: 1950, maxv: 2100 } },
    async preview(ctx, a) {
      const plate = String(a.plate).toUpperCase().replace(/\s+/g, '');
      const dup = await q(`SELECT id FROM vehicles WHERE company_id = $1 AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) = $2`, [ctx.cid, plate.replace(/[^A-Z0-9]/g, '')]);
      if (dup.length) return { err: hu(ctx) ? 'Ez a rendszám már szerepel.' : 'Numărul există deja.' };
      a.plate = plate;
      return { rows: [[hu(ctx) ? 'Rendszám' : 'Nr.', plate], [hu(ctx) ? 'Típus' : 'Tip', a.kind === 'tractor' ? (hu(ctx) ? 'Vontató' : 'Camion') : (hu(ctx) ? 'Pótkocsi' : 'Remorcă')],
        [hu(ctx) ? 'Márka / típus' : 'Marcă / model', [a.brand, a.model].filter(Boolean).join(' ') || '—'], [hu(ctx) ? 'Évjárat' : 'An', a.year || '—']] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('fleet', 'vehicleCreate'), ctx.req, [{ rendszam: a.plate, tip: a.kind === 'tractor' ? 'Vontato' : 'Potkocsi', marca: a.brand, model: a.model, an: a.year }]);
      return r && r.ok ? ok(null, { entity_id: r.id || null }) : r;
    },
  },
  {
    name: 'vehicle.update', domain: 'fleet', kind: 'write', feature: 'vehicles',
    title: L('Jármű módosítása', 'Modificare vehicul'),
    desc: L('Jármű adatainak módosítása: new_plate, brand, model, year, fuel_per_100km (névleges fogyasztás), fuel_correction_l (GPS-tank korrekció), active (true/false), note.', 'Modifică datele vehiculului.'),
    params: { vehicle: { type: 'vehicle', required: true }, new_plate: { type: 'text', max: 20 }, brand: { type: 'text', max: 60 }, model: { type: 'text', max: 60 }, year: { type: 'int', min: 1950, maxv: 2100 },
      fuel_per_100km: { type: 'number', min: 0, maxv: 100 }, fuel_correction_l: { type: 'number', min: -500, maxv: 500 }, active: { type: 'bool' }, note: { type: 'text', max: 500 } },
    async check(ctx, a) {
      if (!['new_plate', 'brand', 'model', 'year', 'fuel_per_100km', 'fuel_correction_l', 'active', 'note'].some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Mit módosítsak a járművön?' : 'Ce modific la vehicul?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const v = (await q(`SELECT * FROM vehicles WHERE id = $1 AND company_id = $2`, [a.vehicle.id, ctx.cid]))[0];
      if (!v) return { err: 'Vehiculul nu a fost gasit.' };
      const rows = [['🛻', v.rendszam]];
      const add = (lab, o, n) => { if (n != null) rows.push([lab, change(o, n)]); };
      add(hu(ctx) ? 'Rendszám' : 'Nr.', v.rendszam, a.new_plate && a.new_plate.toUpperCase());
      add(hu(ctx) ? 'Márka' : 'Marcă', v.marca, a.brand); add('Model', v.model, a.model); add(hu(ctx) ? 'Évjárat' : 'An', v.an, a.year);
      add(hu(ctx) ? 'Fogyasztás L/100' : 'Consum L/100', v.fuel_per_100km, a.fuel_per_100km); add(hu(ctx) ? 'Tank-korrekció L' : 'Corecție L', v.fuel_correction_l, a.fuel_correction_l);
      if (a.active != null) add(hu(ctx) ? 'Aktív' : 'Activ', v.activ ? '✓' : '—', a.active ? '✓' : '—');
      add(hu(ctx) ? 'Megjegyzés' : 'Notă', v.nota, a.note);
      return { rows };
    },
    async snapshot(ctx, a) {
      const v = (await q(`SELECT id, rendszam, marca, model, an, fuel_per_100km, fuel_correction_l, activ, nota FROM vehicles WHERE id = $1 AND company_id = $2`, [a.vehicle.id, ctx.cid]))[0];
      if (!v) return null;
      const map = { new_plate: 'rendszam', brand: 'marca', model: 'model', year: 'an', fuel_per_100km: 'fuel_per_100km', fuel_correction_l: 'fuel_correction_l', active: 'activ', note: 'nota' };
      const b = { id: v.id, f: {} };
      for (const [k, col] of Object.entries(map)) if (a[k] != null) b.f[col] = v[col];
      return b;
    },
    async undo(ctx, b) { return core.callH(H('fleet', 'vehicleUpdate'), ctx.req, [b.id, b.f]); },
    async run(ctx, a) {
      const f = {};
      if (a.new_plate != null) f.rendszam = a.new_plate; if (a.brand != null) f.marca = a.brand; if (a.model != null) f.model = a.model; if (a.year != null) f.an = a.year;
      if (a.fuel_per_100km != null) f.fuel_per_100km = a.fuel_per_100km; if (a.fuel_correction_l != null) f.fuel_correction_l = a.fuel_correction_l;
      if (a.active != null) f.activ = a.active; if (a.note != null) f.nota = a.note;
      const r = await core.callH(H('fleet', 'vehicleUpdate'), ctx.req, [a.vehicle.id, f]);
      return r && r.ok ? ok(null, { entity_id: a.vehicle.id }) : r;
    },
  },
  {
    name: 'vehicle.delete', domain: 'fleet', kind: 'danger', feature: 'vehicles',
    title: L('Jármű törlése', 'Ștergere vehicul'),
    desc: L('Jármű végleges törlése a flottából.', 'Șterge definitiv vehiculul.'),
    params: { vehicle: { type: 'vehicle', required: true } },
    async preview(ctx, a) { return { rows: [['🛻', a.vehicle.plate]] }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleet', 'vehicleDelete'), ctx.req, [a.vehicle.id]);
      return r && r.ok ? ok(null, { entity_id: a.vehicle.id }) : r;
    },
  },
  {
    name: 'vehicle.pair_driver', domain: 'fleet', kind: 'write', feature: 'internal-drivers',
    title: L('Sofőr ↔ vontató párosítás', 'Asociere șofer ↔ camion'),
    desc: L('Belső sofőr hozzárendelése egy vontatóhoz (tractor nélkül = a sofőr párosításának törlése).', 'Asociază șoferul cu un camion (fără camion = anulare).'),
    examples: L(['Gondos a B123ABC-vel jár'], ['Gondos merge cu B123ABC']),
    params: { driver: { type: 'driver', required: true }, tractor: { type: 'tractor' } },
    async preview(ctx, a) {
      const cur = await q(`SELECT rendszam FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = $2`, [ctx.cid, a.driver.email]);
      return { rows: [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Vontató' : 'Camion', change(cur.map((x) => x.rendszam).join(', '), a.tractor ? a.tractor.plate : null)]] };
    },
    async snapshot(ctx, a) {
      const cur = await q(`SELECT id FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = $2 ORDER BY id LIMIT 1`, [ctx.cid, a.driver.email]);
      return { email: a.driver.email, vehicle_id: cur[0] ? cur[0].id : null };
    },
    async undo(ctx, b) { return core.callH(H('fleet', 'assignDriverVehicle'), ctx.req, [b.email, b.vehicle_id]); },
    async run(ctx, a) {
      const r = await core.callH(H('fleet', 'assignDriverVehicle'), ctx.req, [a.driver.email, a.tractor ? a.tractor.id : null]);
      return r && r.ok ? ok(null, { entity_id: a.tractor ? a.tractor.id : null }) : r;
    },
  },
  {
    name: 'vehicle.pair_trailer', domain: 'fleet', kind: 'write', feature: 'internal-drivers',
    title: L('Vontató ↔ pótkocsi párosítás', 'Asociere camion ↔ remorcă'),
    desc: L('Alapértelmezett pótkocsi beállítása egy vontatóhoz (trailer nélkül = törlés).', 'Setează remorca implicită a camionului.'),
    params: { tractor: { type: 'tractor', required: true }, trailer: { type: 'trailer' } },
    async preview(ctx, a) {
      const cur = await q(`SELECT t.rendszam FROM vehicles v LEFT JOIN vehicles t ON t.id = v.default_trailer_id WHERE v.id = $1 AND v.company_id = $2`, [a.tractor.id, ctx.cid]);
      return { rows: [[hu(ctx) ? 'Vontató' : 'Camion', a.tractor.plate], [hu(ctx) ? 'Pótkocsi' : 'Remorcă', change(cur[0] && cur[0].rendszam, a.trailer ? a.trailer.plate : null)]] };
    },
    async snapshot(ctx, a) {
      const cur = await q(`SELECT default_trailer_id FROM vehicles WHERE id = $1 AND company_id = $2`, [a.tractor.id, ctx.cid]);
      return { id: a.tractor.id, trailer_id: cur[0] ? cur[0].default_trailer_id : null };
    },
    async undo(ctx, b) { return core.callH(H('fleet', 'assignDefaultTrailer'), ctx.req, [b.id, b.trailer_id]); },
    async run(ctx, a) {
      const r = await core.callH(H('fleet', 'assignDefaultTrailer'), ctx.req, [a.tractor.id, a.trailer ? a.trailer.id : null]);
      return r && r.ok ? ok(null, { entity_id: a.tractor.id }) : r;
    },
  },
  // ─── Lejáratok ───
  {
    name: 'expiry.list', domain: 'fleet', kind: 'read', feature: 'expiries',
    desc: L('Lejáró dokumentumok (ITP, RCA, rovinieta, tahográf, jogosítvány…) days napon belül (alap 30; 0 = mind), opcionálisan egy járműre/sofőrre szűrve (target).', 'Documente care expiră în N zile.'),
    examples: L(['mi jár le 30 napon belül?', 'mikor jár le a B123ABC ITP-je?'], ['ce expiră în 30 de zile?']),
    params: { days: { type: 'int', min: 0, maxv: 3650, default: 30 }, target: { type: 'text', max: 80 } },
    async run(ctx, a) {
      const p = [ctx.cid]; let w = '';
      if (a.days) { p.push(a.days); w += ` AND expiry_date <= CURRENT_DATE + ($${p.length})::int`; }
      if (a.target) { p.push('%' + String(a.target).replace(/[%_]/g, '') + '%'); w += ` AND (entity_label ILIKE $${p.length} OR REGEXP_REPLACE(entity_label,'[^A-Za-z0-9]','','g') ILIKE REGEXP_REPLACE($${p.length},'[^A-Za-z0-9%]','','g'))`; }
      const rows = await q(`SELECT id, entity_type, entity_label, doc_type, expiry_date, (expiry_date - CURRENT_DATE)::int AS days_left FROM document_expiries WHERE company_id = $1 ${w} ORDER BY expiry_date ASC LIMIT 200`, p);
      return { reply: hu(ctx) ? rows.length + ' tétel.' : rows.length + ' înregistrări.', html: '<div class="och-info">' + listCard(ctx, '⏰', hu(ctx) ? 'Lejáratok' : 'Scadențe', rows, [
        { k: 'entity_label', l: L('Mire', 'Pentru') }, { k: 'doc_type', l: L('Dokumentum', 'Document') }, { k: 'expiry_date', l: L('Lejár', 'Expiră'), f: (v) => fmtD(d10(v)) },
        { k: 'days_left', l: L('Nap', 'Zile'), f: (v) => ({ __html: '<b style="color:' + (v < 0 ? '#dc2626' : v <= 14 ? '#d97706' : 'inherit') + '">' + esc(v) + '</b>' }) }]) + '</div>' };
    },
  },
  {
    name: 'expiry.set', domain: 'fleet', kind: 'write', feature: 'expiries',
    title: L('Lejárat rögzítése', 'Înregistrare scadență'),
    desc: L('Lejárati dátum rögzítése vagy frissítése egy járműhöz VAGY sofőrhöz. doc_type: ' + Object.keys(DOC).join('|') + '. Ha már van ilyen tétel, a dátumát frissíti.', 'Setează data de expirare pentru vehicul sau șofer.'),
    examples: L(['a B123ABC ITP-je 2027-03-15-én jár le', 'Gondos jogosítványa jövő májusban jár le'], ['ITP B123ABC expiră pe 2027-03-15']),
    params: { vehicle: { type: 'vehicle' }, driver: { type: 'driver' }, doc_type: { type: 'enum', values: Object.keys(DOC), required: true }, expiry_date: { type: 'date', required: true }, alert_days: { type: 'int', min: 0, maxv: 365 }, note: { type: 'text', max: 200 } },
    async check(ctx, a) {
      if (!a.vehicle && !a.driver) return { ask: { text: hu(ctx) ? 'Melyik járműre vagy sofőrre vonatkozik?' : 'Pentru ce vehicul sau șofer?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const lbl = a.vehicle ? a.vehicle.plate : a.driver.name;
      const all = Object.values(DOC[a.doc_type]);
      const cur = await q(`SELECT id, doc_type, expiry_date FROM document_expiries WHERE company_id = $1 AND entity_type = $2 AND LOWER(entity_label) = LOWER($3) AND doc_type = ANY($4::text[]) ORDER BY expiry_date DESC LIMIT 1`,
        [ctx.cid, a.vehicle ? 'vehicle' : 'driver', lbl, all]);
      a.id = cur[0] ? cur[0].id : null;
      a.label = lbl;
      a.doc_label = DOC[a.doc_type][ctx.lang];
      return { rows: [[hu(ctx) ? 'Mire' : 'Pentru', lbl], [hu(ctx) ? 'Dokumentum' : 'Document', a.doc_label], [hu(ctx) ? 'Lejár' : 'Expiră', change(cur[0] ? fmtD(d10(cur[0].expiry_date)) : null, fmtD(a.expiry_date))]] };
    },
    async snapshot(ctx, a) {
      if (!a.id) return null;
      const r = await q(`SELECT id, entity_type, entity_label, doc_type, expiry_date, alert_days, note FROM document_expiries WHERE id = $1 AND company_id = $2`, [a.id, ctx.cid]);
      return r[0] ? Object.assign({}, r[0], { expiry_date: d10(r[0].expiry_date) }) : null;
    },
    async undo(ctx, b) {
      if (!b || !b.id) return { ok: false, err: core.tx(ctx.lang).undoNo };
      return core.callH(H('fleetCompliance', 'expirySave'), ctx.req, [b.id, b]);
    },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'expirySave'), ctx.req, [a.id || null, { entity_type: a.vehicle ? 'vehicle' : 'driver', entity_label: a.label, doc_type: a.doc_label, expiry_date: a.expiry_date, alert_days: a.alert_days != null ? a.alert_days : 30, note: a.note }]);
      return r && r.ok ? ok(null, { entity_id: a.id }) : r;
    },
  },
  // ─── Szerviz ───
  {
    name: 'service.due', domain: 'fleet', kind: 'read', feature: 'service-log',
    desc: L('Esedékes / hamarosan esedékes szervizek (km és dátum alapján).', 'Revizii scadente (km și dată).'),
    examples: L(['melyik autónak esedékes a szerviz?'], ['ce revizii sunt scadente?']),
    async run(ctx) {
      const r = await core.callH(H('fleetCompliance', 'getServiceDueAlerts'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '🔧', hu(ctx) ? 'Esedékes szervizek' : 'Revizii scadente', r.items || [], [
        { k: 'rendszam', l: L('Jármű', 'Vehicul'), f: (v, x) => ({ __html: '<a href="#" onclick="OrderChat.runUi({op:\'svDecide\',id:\'' + esc(x.id) + '\'});return false;">' + esc(v) + '</a>' }) },
        { k: 'description', l: L('Szerviz', 'Revizie') }, { k: 'km_left', l: L('Km hátra', 'Km rămași'), f: (v) => (v != null ? fmtN(v, 0) : '') },
        { k: 'days_left', l: L('Nap hátra', 'Zile'), f: (v) => (v != null ? String(v) : '') }]) + '</div>' };
    },
  },
  {
    name: 'service.list', domain: 'fleet', kind: 'read', feature: 'service-log',
    desc: L('Egy jármű szerviz-naplója.', 'Jurnalul de service al vehiculului.'),
    params: { vehicle: { type: 'vehicle', required: true } },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'serviceList'), ctx.req, [{ vehicleId: a.vehicle.id }]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '🔧', a.vehicle.plate, r.items || [], [
        { k: 'service_date', l: L('Dátum', 'Data'), f: (v) => fmtD(d10(v)) }, { k: 'km', l: L('Km', 'Km'), f: (v) => (v != null ? fmtN(num(v), 0) : '') },
        { k: 'description', l: L('Leírás', 'Descriere') }, { k: 'cost_ron', l: L('Költség (RON)', 'Cost (RON)'), f: (v) => (v != null ? fmtN(num(v), 0) : '') },
        { k: 'next_due_date', l: L('Következő', 'Următoarea'), f: (v, x) => [v ? fmtD(d10(v)) : null, x.next_due_km ? fmtN(num(x.next_due_km), 0) + ' km' : null].filter(Boolean).join(' / ') }]) + '</div>' };
    },
  },
  {
    name: 'service.add', domain: 'fleet', kind: 'write', feature: 'service-log',
    title: L('Szerviz rögzítése', 'Înregistrare service'),
    desc: L('Elvégzett szerviz/javítás rögzítése: vehicle, date, km, category (' + SVC_CATS.join('|') + '), description, cost_ron, next_due_date, next_due_km.', 'Înregistrează un service efectuat.'),
    examples: L(['a B123ABC-n ma olajcsere volt 412000 km-nél, 1800 lej'], ['schimb ulei B123ABC azi la 412000 km, 1800 lei']),
    params: { vehicle: { type: 'vehicle', required: true }, date: { type: 'date' }, km: { type: 'number', min: 0, maxv: 1e8 }, category: { type: 'enum', values: SVC_CATS, default: 'javitas' }, description: { type: 'text', max: 300 },
      cost_ron: { type: 'money', min: 0 }, next_due_date: { type: 'date' }, next_due_km: { type: 'number', min: 0, maxv: 1e8 } },
    async preview(ctx, a) {
      a.date = a.date || di._h.iso(ctx.now);
      return { rows: [['🛻', a.vehicle.plate], [hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date)], ['Km', a.km != null ? fmtN(a.km, 0) : '—'], [hu(ctx) ? 'Kategória' : 'Categorie', a.category],
        [hu(ctx) ? 'Leírás' : 'Descriere', a.description || '—'], [hu(ctx) ? 'Költség' : 'Cost', a.cost_ron != null ? fmtN(a.cost_ron, 2) + ' RON' : '—'],
        [hu(ctx) ? 'Következő' : 'Următoarea', [a.next_due_date ? fmtD(a.next_due_date) : null, a.next_due_km ? fmtN(a.next_due_km, 0) + ' km' : null].filter(Boolean).join(' / ') || '—']] };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('fleetCompliance', 'serviceDelete'), ctx.req, [res.id]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'serviceCreate'), ctx.req, [{ vehicle_id: a.vehicle.id, service_date: a.date, km: a.km, category: a.category, description: a.description, cost_ron: a.cost_ron, next_due_date: a.next_due_date, next_due_km: a.next_due_km }]);
      return r && r.ok ? ok(null, { entity_id: r.id }) : r;
    },
  },
  {
    name: 'service.postpone', domain: 'fleet', kind: 'write', feature: 'service-log',
    title: L('Szerviz halasztása', 'Amânare service'),
    desc: L('Egy jármű esedékes szervizének halasztása új dátumra és/vagy km-re.', 'Amână revizia scadentă a vehiculului.'),
    params: { vehicle: { type: 'vehicle', required: true }, next_due_date: { type: 'date' }, next_due_km: { type: 'number', min: 0, maxv: 1e8 }, note: { type: 'text', max: 200 } },
    async check(ctx, a) {
      if (a.next_due_date == null && a.next_due_km == null) return { ask: { text: hu(ctx) ? 'Mikorra vagy hány km-re halasszam?' : 'Până când sau la câți km amân?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const s = await openService(ctx.cid, a.vehicle.id);
      if (!s) return { err: hu(ctx) ? 'Ennek a járműnek nincs nyitott, esedékes szerviz-tétele.' : 'Vehiculul nu are revizie scadentă deschisă.' };
      a.service_id = s.id;
      const rows = [['🛻', a.vehicle.plate], [hu(ctx) ? 'Szerviz' : 'Service', s.description || '—']];
      if (a.next_due_date) rows.push([hu(ctx) ? 'Esedékes' : 'Scadent', change(fmtD(d10(s.next_due_date)), fmtD(a.next_due_date))]);
      if (a.next_due_km) rows.push(['Km', change(s.next_due_km != null ? fmtN(num(s.next_due_km), 0) : null, fmtN(a.next_due_km, 0))]);
      return { rows };
    },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'servicePostpone'), ctx.req, [a.service_id, { next_due_date: a.next_due_date, next_due_km: a.next_due_km, note: a.note }]);
      return r && r.ok ? ok(null, { entity_id: a.service_id }) : r;
    },
  },
  {
    name: 'service.complete', domain: 'fleet', kind: 'write', feature: 'service-log',
    title: L('Szerviz elvégezve', 'Service efectuat'),
    desc: L('Az esedékes szerviz lezárása elvégzettként: date, km, items (vesszővel: ' + SVC_ITEMS.join(',') + '), cost_ron, description, next_due_date, next_due_km (alap: +1 év / +40000 km).', 'Marchează revizia scadentă ca efectuată.'),
    params: { vehicle: { type: 'vehicle', required: true }, date: { type: 'date' }, km: { type: 'number', min: 0, maxv: 1e8 }, items: { type: 'text', max: 300 }, cost_ron: { type: 'money', min: 0 }, description: { type: 'text', max: 300 },
      next_due_date: { type: 'date' }, next_due_km: { type: 'number', min: 0, maxv: 1e8 } },
    async preview(ctx, a) {
      const s = await openService(ctx.cid, a.vehicle.id);
      if (!s) return { err: hu(ctx) ? 'Ennek a járműnek nincs nyitott, esedékes szerviz-tétele.' : 'Vehiculul nu are revizie scadentă deschisă.' };
      a.service_id = s.id;
      a.date = a.date || di._h.iso(ctx.now);
      a.items_list = String(a.items || '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => SVC_ITEMS.includes(x)).slice(0, 17);
      if (!a.next_due_date) { const d = new Date(a.date + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); a.next_due_date = di._h.iso(d); }
      if (a.next_due_km == null && a.km != null) a.next_due_km = a.km + 40000;
      return { rows: [['🛻', a.vehicle.plate], [hu(ctx) ? 'Szerviz' : 'Service', s.description || '—'], [hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date)], ['Km', a.km != null ? fmtN(a.km, 0) : '—'],
        [hu(ctx) ? 'Tételek' : 'Elemente', a.items_list.join(', ') || '—'], [hu(ctx) ? 'Költség' : 'Cost', a.cost_ron != null ? fmtN(a.cost_ron, 2) + ' RON' : '—'],
        [hu(ctx) ? 'Következő' : 'Următoarea', [fmtD(a.next_due_date), a.next_due_km ? fmtN(a.next_due_km, 0) + ' km' : null].filter(Boolean).join(' / ')]] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'serviceComplete'), ctx.req, [a.service_id, { service_date: a.date, km: a.km, items: (a.items_list || []).map((k) => ({ key: k })), cost_ron: a.cost_ron, description: a.description, category: 'karbantartas', next_due_date: a.next_due_date, next_due_km: a.next_due_km }]);
      return r && r.ok ? ok(null, { entity_id: a.service_id }) : r;
    },
  },
  {
    name: 'fuel.compare', domain: 'fleet', kind: 'read', feature: 'fuel-import',
    desc: L('Üzemanyagkártya vs. sofőr által rögzített tankolás eltérése járművenként egy időszakra.', 'Comparație card combustibil vs. alimentări raportate.'),
    params: { period: { type: 'period', default: 'this_month' } },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'fuelCompare'), ctx.req, [{ from: a.period.from, to: a.period.to }]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '⛽', (hu(ctx) ? 'Kártya vs. sofőr ' : 'Card vs. șofer ') + fmtD(a.period.from) + ' – ' + fmtD(a.period.to), r.rows || [], [
        { k: 'rendszam', l: L('Jármű', 'Vehicul') }, { k: 'card_l', l: L('Kártya L', 'Card L'), f: (v) => fmtN(num(v), 0) }, { k: 'drv_l', l: L('Sofőr L', 'Șofer L'), f: (v) => fmtN(num(v), 0) },
        { k: 'diff_l', l: L('Eltérés L', 'Dif. L'), f: (v) => fmtN(num(v), 1) }, { k: 'diff_pct', l: L('%', '%'), f: (v) => (v != null ? v + '%' : '') }]) + '</div>' };
    },
  },
];
module.exports._DOC = DOC;
