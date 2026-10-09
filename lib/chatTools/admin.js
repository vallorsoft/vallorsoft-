// ============================================================
//  VallorSoft — lib/chatTools/admin.js
//  💬 AI-chat 2.0 — 2. kör: a maradék konzol-funkciók chatből.
//   - tömeges utólagos teendő a kijelölt / felsorolt fuvarokon
//   - UIT-kód felvitele + listája, fuvar-szakasz (átrakás) felvétele
//   - e-CMR létrehozása, költség-kalkuláció egy fuvarra (+ mentés)
//   - KPI-cél, cégbeállítások (árfolyam, IBAN, kapcsolat…), dokumentum-
//     nyilvántartás bejegyzés módosítása / sztornója
//  Írás MINDIG a meglévő handleren (vagy a meglévő REST-logika közös
//  függvényén — routes/uit.js addUitCode) át, company_id-szűrten.
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');
const ordersT = require('./orders');

const { esc, fmtN, fmtD, num } = core.fmt;
const { change, listCard, kvCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const hu = (ctx) => ctx.lang === 'hu';
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const iso = (d) => di._h.iso(d);
const d10 = (v) => (v instanceof Date ? iso(v) : (v ? String(v).slice(0, 10) : ''));
const nos = (list) => list.map((o) => '#' + o.no).slice(0, 12).join(', ') + (list.length > 12 ? ' …(+' + (list.length - 12) + ')' : '');
const fmtUit = (s) => require('../uitFormat').formatUit(s);

// ─── KPI-cél metrikák (handlers/statsV2.js METRICS) ───
const METRIC = {
  revenue: L('Bevétel (EUR)', 'Venit (EUR)'), profit: L('Eredmény (EUR)', 'Profit (EUR)'), closed_orders: L('Lezárt fuvarok', 'Curse finalizate'),
  active_orders: L('Aktív fuvarok', 'Curse active'), consum_l100: L('Átlagfogyasztás L/100', 'Consum mediu L/100'), km_month: L('Km / hó', 'Km / lună'),
  utilization: L('Kihasználtság %', 'Utilizare %'), on_time_pct: L('Időben teljesített %', 'La timp %'),
};
const PERIOD = { month: L('havi', 'lunar'), quarter: L('negyedéves', 'trimestrial'), year: L('éves', 'anual') };

// ─── Cégbeállítás mezők (args → saveCompanySettings kulcs) ───
const CS = {
  eur_ron_rate: { k: 'eurRonRate', l: L('EUR/RON árfolyam (saját)', 'Curs EUR/RON (propriu)') },
  iban: { k: 'iban', l: L('IBAN', 'IBAN') }, bank: { k: 'banca', l: L('Bank', 'Banca') },
  phone: { k: 'telefon', l: L('Telefon', 'Telefon') }, email: { k: 'emailContact', l: L('Kapcsolati e-mail', 'E-mail contact') },
  website: { k: 'website', l: L('Weboldal', 'Website') }, address: { k: 'adresa', l: L('Cím', 'Adresa') },
  director: { k: 'igazgatoNev', l: L('Ügyvezető', 'Administrator') }, reg_com: { k: 'regCom', l: L('Reg.Com.', 'Reg.Com.') },
  brand_color: { k: 'brandColor', l: L('Márka-szín', 'Culoare brand') }, waybill_prefix: { k: 'waybillPrefix', l: L('Menetlevél-előtag', 'Prefix foaie de parcurs') },
};

async function findRegEntry(ctx, raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const rows = await q(`SELECT e.*, g.name AS group_name FROM doc_register_entries e JOIN doc_register_groups g ON g.id = e.group_id AND g.company_id = e.company_id
                         WHERE e.company_id = $1 AND (UPPER(e.reg_no) = UPPER($2) OR UPPER(e.reg_no) LIKE '%' || UPPER($2)) ORDER BY e.created_at DESC LIMIT 3`, [ctx.cid, s]);
  if (!rows.length) return null;
  return rows.length > 1 && rows[0].reg_no.toUpperCase() !== s.toUpperCase() ? { amb: rows.map((r) => r.reg_no) } : rows[0];
}

module.exports = [
  // ─── Tömeges utólagos teendő ───
  {
    name: 'order.bulk_post_delivery', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Tömeges fuvar-módosítás', 'Modificare în masă'),
    desc: L('Több fuvar egyszerre (orders = "selected" a kijelöltekre, vagy fuvarszám-lista): finalize (lezárás true), invoice_no, postal_sent, postal_received (dátum), payment_status (pending|paid|delayed), note.', 'Mai multe curse deodată (orders = "selected" sau listă): finalizare, nr. factură, poștă, plată, notă.'),
    examples: L(['a kijelölteket jelöld fizetettnek', 'a 0042, 0043 és 0044 postázva ma'], ['marchează selectatele ca plătite', '0042, 0043 trimise azi prin poștă']),
    params: { orders: { type: 'orders', required: true }, finalize: { type: 'bool' }, invoice_no: { type: 'text', max: 50 }, postal_sent: { type: 'date' }, postal_received: { type: 'date' },
      payment_status: { type: 'enum', values: ['pending', 'paid', 'delayed'] }, note: { type: 'text', max: 500 } },
    async check(ctx, a) {
      if (!a.finalize && !['invoice_no', 'postal_sent', 'postal_received', 'payment_status', 'note'].some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Mit állítsak be a fuvarokon (lezárás, számlaszám, postázás, fizetés)?' : 'Ce setez pe curse?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const rows = [[hu(ctx) ? 'Fuvarok' : 'Curse', a.orders.length + ' — ' + nos(a.orders)]];
      if (a.finalize) rows.push([hu(ctx) ? 'Lezárás' : 'Finalizare', '✓ Finalizat']);
      if (a.invoice_no != null) rows.push([hu(ctx) ? 'Számlaszám' : 'Nr. factură', a.invoice_no]);
      if (a.postal_sent != null) rows.push([hu(ctx) ? 'Postázva' : 'Trimis poștă', fmtD(a.postal_sent)]);
      if (a.postal_received != null) rows.push([hu(ctx) ? 'Megérkezett' : 'Primit', fmtD(a.postal_received)]);
      if (a.payment_status != null) rows.push([hu(ctx) ? 'Fizetés' : 'Plată', a.payment_status]);
      if (a.note != null) rows.push([hu(ctx) ? 'Megjegyzés' : 'Notă', a.note]);
      return { rows, label: a.orders.length + (hu(ctx) ? ' fuvar' : ' curse') };
    },
    // A lezárás (státusz) nem vonható vissza egy lépésben → csak a dokumentum-mezőknél van visszavonás.
    async snapshot(ctx, a) {
      if (a.finalize) return null;
      const out = [];
      for (const o of a.orders.slice(0, 500)) { const s = await ordersT._snapOrder(ctx, o.id, ordersT._PD_KEYS); if (s) out.push(s); }
      return { list: out };
    },
    async undo(ctx, b) {
      for (const s of (b && b.list) || []) {
        const p = { order_id: s.id }; ordersT._PD_KEYS.forEach((k) => { p[k] = s[k]; });
        const r = await core.callH(H('orderPostDelivery', 'setOrderPostDelivery'), ctx.req, [p]);
        if (!r || r.ok === false) return r;
      }
      return { ok: true };
    },
    async run(ctx, a) {
      const p = { order_ids: a.orders.map((o) => o.id) };
      if (a.finalize) p.finalize = true;
      if (a.invoice_no != null) p.invoice_no = a.invoice_no;
      if (a.postal_sent != null) p.postal_sent_at = a.postal_sent;
      if (a.postal_received != null) p.postal_received_at = a.postal_received;
      if (a.payment_status != null) { p.payment_status_ext = a.payment_status; if (a.payment_status === 'paid') p.payment_received_at = iso(new Date()); }
      if (a.note != null) p.post_notes = a.note;
      const r = await core.callH(H('orderPostDelivery', 'setOrderPostDeliveryBulk'), ctx.req, [p]);
      if (!r || r.ok === false) return r;
      return ok((hu(ctx) ? '✅ Módosítva: ' : '✅ Modificate: ') + (r.updated != null ? r.updated : a.orders.length) + (hu(ctx) ? ' fuvar.' : ' curse.'), { entity_id: a.orders[0].id });
    },
  },
  // ─── UIT ───
  {
    name: 'order.uit_list', domain: 'orders', kind: 'read', feature: 'orders-list',
    desc: L('Egy fuvar UIT-kódjai (e-Transport).', 'Codurile UIT ale unei curse.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async run(ctx, a) {
      const rows = await q(`SELECT id, uit_code, rendszam, status, valid_until, source, created_at FROM order_uit_codes WHERE company_id = $1 AND order_id = $2 ORDER BY created_at`, [ctx.cid, a.order.id]);
      return { reply: (hu(ctx) ? 'UIT-kódok — #' : 'Coduri UIT — #') + a.order.no, html: '<div class="och-info">' + listCard(ctx, '🛣️', 'UIT #' + a.order.no, rows, [
        { k: 'uit_code', l: L('Kód', 'Cod'), f: (v) => fmtUit(v) }, { k: 'rendszam', l: L('Rendszám', 'Nr.') }, { k: 'status', l: L('Állapot', 'Stare') },
        { k: 'valid_until', l: L('Érvényes', 'Valabil'), f: (v) => fmtD(d10(v)) }, { k: 'source', l: L('Forrás', 'Sursă') }]) + '</div>' };
    },
  },
  {
    name: 'order.uit_add', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('UIT-kód felvitele', 'Adăugare cod UIT'),
    desc: L('UIT-kód rögzítése egy fuvarhoz (code: max 16 betű/szám, kötőjelekkel is), valid_until opcionális.', 'Adaugă un cod UIT la cursă (max 16 caractere).'),
    examples: L(['a 0042 UIT-kódja AB12-CD34-EF56-GH78'], ['codul UIT pentru 0042 este AB12CD34EF56GH78']),
    params: { order: { type: 'order', required: true, fromHistory: true }, code: { type: 'text', required: true, max: 40 }, valid_until: { type: 'date' } },
    async check(ctx, a) {
      const f = require('../uitFormat');
      const n = f.normalizeUit(a.code);
      if (!f.isValidUit(n)) return { err: hu(ctx) ? 'A UIT-kód legfeljebb 16 betű/szám lehet.' : 'Codul UIT are max 16 caractere alfanumerice.' };
      a.code = n; return null;
    },
    async preview(ctx, a) {
      const dup = await q(`SELECT 1 FROM order_uit_codes WHERE company_id = $1 AND order_id = $2 AND uit_code = $3`, [ctx.cid, a.order.id, a.code]);
      if (dup.length) return { err: hu(ctx) ? 'Ez a UIT már szerepel ennél a fuvarnál.' : 'UIT-ul există deja la această cursă.' };
      return { rows: [['#', a.order.no], ['UIT', fmtUit(a.code)], [hu(ctx) ? 'Érvényes' : 'Valabil', a.valid_until ? fmtD(a.valid_until) : '—']] };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) {
      const id = res && res.id;
      if (!id) return { ok: false };
      await q(`DELETE FROM order_uit_codes WHERE id = $1 AND company_id = $2`, [id, ctx.cid]);
      return { ok: true };
    },
    async run(ctx, a) {
      const r = await require('../../routes/uit').addUitCode(ctx.cid, ctx.uid, a.order.id, { uit_code: a.code, valid_until: a.valid_until || null, source: 'manual' });
      if (r.error) return { ok: false, err: r.error };
      return ok((hu(ctx) ? '✅ UIT rögzítve: ' : '✅ UIT salvat: ') + fmtUit(a.code), { order_id: a.order.id, entity_id: r.item.id });
    },
  },
  // ─── Fuvar-szakasz (átrakás / sofőrcsere útközben) ───
  {
    name: 'order.leg_add', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Új szakasz (átadás)', 'Tronson nou (predare)'),
    desc: L('Új szakasz a fuvaron: útközben más sofőr / jármű viszi tovább (driver, tractor, trailer, place = átvétel helye, date).', 'Tronson nou: alt șofer / vehicul preia cursa (șofer, camion, remorcă, loc, dată).'),
    examples: L(['a 0042-t Aradtól Kovács viszi tovább a B123ABC-vel'], ['de la Arad cursa 0042 o preia Kovács cu B123ABC']),
    params: { order: { type: 'order', required: true, fromHistory: true }, driver: { type: 'driver' }, tractor: { type: 'tractor' }, trailer: { type: 'trailer' }, place: { type: 'text', max: 200 }, date: { type: 'date' } },
    async check(ctx, a) {
      if (!a.driver && !a.tractor) return { ask: { text: hu(ctx) ? 'Ki (melyik sofőr / jármű) viszi tovább?' : 'Cine preia cursa (șofer / camion)?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      return { rows: [['#', a.order.no], [hu(ctx) ? 'Sofőr' : 'Șofer', a.driver ? a.driver.name : '—'], [hu(ctx) ? 'Vontató' : 'Camion', a.tractor ? a.tractor.plate : '—'],
        [hu(ctx) ? 'Pótkocsi' : 'Remorcă', a.trailer ? a.trailer.plate : '—'], [hu(ctx) ? 'Átvétel helye' : 'Loc preluare', a.place || '—'], [hu(ctx) ? 'Dátum' : 'Data', a.date ? fmtD(a.date) : '—']] };
    },
    async snapshot(ctx, a) { return ordersT._snapOrder(ctx, a.order.id, ['email_sofer', 'nume_sofer', 'rendszam_camion', 'rendszam_remorca', 'sofer_type', 'status']); },
    async undo(ctx, b, res) {
      const legId = res && res.id;
      if (!legId) return { ok: false };
      return core.callH(H('orders', 'deleteOrderLeg'), ctx.req, [legId]);
    },
    async run(ctx, a) {
      const leg = { sofer_type: 'Intern', loc_preluare: a.place || null, data_preluare: a.date || null };
      if (a.driver) { leg.email_sofer = a.driver.email; leg.nume_sofer = a.driver.name; }
      if (a.tractor) leg.rendszam_camion = a.tractor.plate;
      if (a.trailer) leg.rendszam_remorca = a.trailer.plate;
      const r = await core.callH(H('orders', 'addOrderLeg'), ctx.req, [a.order.id, leg]);
      if (!r || r.ok === false) return r;
      const lg = await q(`SELECT l.id FROM order_legs l JOIN orders o ON o.id = l.order_id AND o.company_id = $1 WHERE l.order_id = $2 AND l.leg_number = $3`, [ctx.cid, a.order.id, r.leg_number]);
      return ok((hu(ctx) ? '✅ ' + r.leg_number + '. szakasz felvéve.' : '✅ Tronsonul ' + r.leg_number + ' adăugat.'), { order_id: a.order.id, entity_id: lg[0] ? lg[0].id : null });
    },
  },
  // ─── e-CMR ───
  {
    name: 'ecmr.create', domain: 'docs', kind: 'write', feature: 'ecmr',
    title: L('e-CMR létrehozása', 'Creare e-CMR'),
    desc: L('Digitális fuvarlevél (e-CMR) létrehozása egy fuvarhoz; utána a három fél aláírhatja az e-CMR oldalon.', 'Creează e-CMR pentru o cursă.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const ex = await q(`SELECT id, status FROM order_ecmr WHERE company_id = $1 AND order_id = $2 AND status <> 'cancelled'`, [ctx.cid, a.order.id]).catch(() => []);
      if (ex.length) return { reply: (hu(ctx) ? 'Ennek a fuvarnak már van e-CMR-je (állapot: ' : 'Cursa are deja e-CMR (stare: ') + ex[0].status + ').' };
      return { rows: [['#', a.order.no], ['e-CMR', hu(ctx) ? 'új, aláírásra vár' : 'nou, de semnat']] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('ecmr', 'ecmrCreate'), ctx.req, [a.order.id]);
      if (!r || r.ok === false) return r;
      return ok(hu(ctx) ? '✅ e-CMR létrehozva — az aláíráshoz megnyitottam az e-CMR oldalt.' : '✅ e-CMR creat — am deschis pagina e-CMR pentru semnare.', { order_id: a.order.id, entity_id: r.id, ui: { op: 'tab', tab: 'ecmr' } });
    },
  },
  // ─── Költség-kalkuláció egy fuvarra ───
  {
    name: 'vcalc.order_cost', domain: 'finance', kind: 'read', feature: 'vcalc-run',
    desc: L('Egy fuvar költség-kalkulációja és várható eredménye a mentett jármű-/sofőr-/cégköltségekből (fuel_price = gázolaj bruttó ár RON/liter; fuel_l100 felülírja a jármű fogyasztását).', 'Calculul costului și profitului unei curse (fuel_price = preț motorină brut RON/l).'),
    examples: L(['mennyibe kerül nekünk a 0042, ha a gázolaj 7,2 lej?', 'számold ki a 0042 eredményét'], ['cât ne costă cursa 0042 la motorina de 7,2 lei?']),
    params: { order: { type: 'order', required: true, fromHistory: true }, fuel_price: { type: 'number', required: true, min: 1, maxv: 30, hint: 'RON/l' }, fuel_l100: { type: 'number', min: 5, maxv: 80 } },
    async run(ctx, a) {
      const pf = await core.callH(H('costCalculator', 'vcalcPrefillFromOrder'), ctx.req, [{ order_id: a.order.id }]);
      if (!pf || pf.ok === false) return pf;
      const o = pf.order || {};
      if (!o.km) return { ok: false, err: hu(ctx) ? 'A fuvarnak nincs km-értéke — add meg előbb (pl. „a 0042 km-e 1350").' : 'Cursa nu are km — setează mai întâi.' };
      const l100 = a.fuel_l100 || (pf.truck && num(pf.truck.fuel_per_100km)) || 30;
      const form = {
        order_id: o.id, trip_km: o.km, trip_days: pf.trip_days, truck_vehicle_id: pf.truck && pf.truck.id, trailer_vehicle_id: pf.trailer && pf.trailer.id,
        driver_ids: pf.driver ? [pf.driver.id] : [], fuel_method: 'per_liter', fuel_l_per_100km: l100, fuel_price_gross: a.fuel_price,
        tolls: o.toll_cost_eur ? [{ amount: o.toll_cost_eur, input_currency: 'eur', description: 'toll' }] : [], active_trucks: pf.active_trucks,
        freight_revenue_input: o.pret, freight_revenue_currency: 'eur', freight_revenue_is_gross: false, bnr_eur_lei: pf.bnr_eur_lei,
      };
      const c = await core.callH(H('costCalculator', 'vcalcCalculate'), ctx.req, [form]);
      if (!c || c.ok === false) return c;
      const r = c.result || {};
      const lei = (v) => (v == null ? '—' : fmtN(num(v), 0) + ' RON');
      const eur = (v) => (v == null ? '—' : fmtN(num(v), 0) + ' EUR');
      const lines = (r.lines || []).filter((x) => num(x.netLei) > 0).slice(0, 12).map((x) => [x.name || '—', lei(x.netLei)]);
      const rows = [[hu(ctx) ? 'Út' : 'Traseu', fmtN(o.km, 0) + ' km · ' + pf.trip_days + (hu(ctx) ? ' nap' : ' zile')],
        [hu(ctx) ? 'Jármű / sofőr' : 'Vehicul / șofer', [pf.truck && pf.truck.rendszam, pf.driver && pf.driver.nume].filter(Boolean).join(' · ') || '—'],
        [hu(ctx) ? 'Üzemanyag' : 'Combustibil', l100 + ' L/100 × ' + a.fuel_price + ' RON → ' + lei(r.fuelNet)]].concat(lines).concat([
        [hu(ctx) ? 'Összes költség (nettó)' : 'Cost total (net)', lei(r.totalNet) + ' ≈ ' + eur(r.totalNetEur)],
        [hu(ctx) ? 'Fuvardíj (nettó)' : 'Preț cursă (net)', o.pret != null ? eur(o.pret) : '—'],
        [hu(ctx) ? 'Várható eredmény' : 'Profit estimat', r.profitEur != null ? { __html: '<b style="color:' + (r.profitEur >= 0 ? '#16a34a' : '#dc2626') + '">' + esc(eur(r.profitEur)) + '</b>' } : '—']]);
      const reply = r.profitEur != null
        ? (hu(ctx) ? 'A #' + a.order.no + ' várható eredménye ' + eur(r.profitEur) + ' (költség ≈ ' + eur(r.totalNetEur) + ').' : 'Profitul estimat pentru #' + a.order.no + ' este ' + eur(r.profitEur) + ' (cost ≈ ' + eur(r.totalNetEur) + ').')
        : (hu(ctx) ? 'A #' + a.order.no + ' költsége ≈ ' + eur(r.totalNetEur) + ' (nincs fuvardíj megadva).' : 'Costul #' + a.order.no + ' ≈ ' + eur(r.totalNetEur) + '.');
      return { reply, html: '<div class="och-info">' + kvCard('🧮', (hu(ctx) ? 'Költség-kalkuláció — #' : 'Calcul cost — #') + a.order.no, rows)
        + '<div class="och-info-btns"><button type="button" class="och-info-btn" data-text="' + esc((hu(ctx) ? 'mentsd el a #' : 'salvează calculul #') + a.order.no + (hu(ctx) ? ' kalkulációját, gázolaj ' : ', motorină ') + a.fuel_price) + '" onclick="OrderChat.prefill(this)">💾 ' + (hu(ctx) ? 'Mentés' : 'Salvează') + '</button></div></div>' };
    },
  },
  {
    name: 'vcalc.order_cost_save', domain: 'finance', kind: 'write', feature: 'vcalc-run',
    title: L('Kalkuláció mentése', 'Salvare calcul'),
    desc: L('Egy fuvar költség-kalkulációjának mentése a Mentett kalkulációk közé (fuel_price = RON/liter).', 'Salvează calculul costului unei curse.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, fuel_price: { type: 'number', required: true, min: 1, maxv: 30 }, fuel_l100: { type: 'number', min: 5, maxv: 80 } },
    async preview(ctx, a) {
      return { rows: [['#', a.order.no], [hu(ctx) ? 'Gázolaj' : 'Motorină', a.fuel_price + ' RON/l'], ['L/100', a.fuel_l100 || (hu(ctx) ? 'a jármű értéke' : 'valoarea vehiculului')]] };
    },
    async run(ctx, a) {
      const pf = await core.callH(H('costCalculator', 'vcalcPrefillFromOrder'), ctx.req, [{ order_id: a.order.id }]);
      if (!pf || pf.ok === false) return pf;
      const o = pf.order || {};
      const r = await core.callH(H('costCalculator', 'vcalcCalculate'), ctx.req, [{
        save: true, source_mode: 'vallorsoft', name: '#' + a.order.no, order_id: o.id, trip_km: o.km, trip_days: pf.trip_days,
        truck_vehicle_id: pf.truck && pf.truck.id, trailer_vehicle_id: pf.trailer && pf.trailer.id, driver_ids: pf.driver ? [pf.driver.id] : [],
        fuel_method: 'per_liter', fuel_l_per_100km: a.fuel_l100 || (pf.truck && num(pf.truck.fuel_per_100km)) || 30, fuel_price_gross: a.fuel_price,
        tolls: o.toll_cost_eur ? [{ amount: o.toll_cost_eur, input_currency: 'eur', description: 'toll' }] : [], active_trucks: pf.active_trucks,
        freight_revenue_input: o.pret, freight_revenue_currency: 'eur', freight_revenue_is_gross: false, bnr_eur_lei: pf.bnr_eur_lei }]);
      if (!r || r.ok === false) return r;
      return ok((hu(ctx) ? '✅ Kalkuláció mentve: ' : '✅ Calcul salvat: ') + r.serial_no, { order_id: a.order.id, entity_id: r.id });
    },
  },
  // ─── KPI-cél (Statisztika 2.0) ───
  {
    name: 'stats.goal_set', domain: 'stats', kind: 'write', feature: 'stats-v2', roles: ['Admin'],
    title: L('KPI-cél beállítása', 'Setare țintă KPI'),
    desc: L('Statisztikai cél-érték: metric (' + Object.keys(METRIC).join('|') + '), period (month|quarter|year), target.', 'Țintă KPI: metric, perioadă, valoare.'),
    examples: L(['a havi bevételi cél legyen 120000 euró'], ['ținta lunară de venit 120000 euro']),
    params: { metric: { type: 'enum', values: Object.keys(METRIC), required: true }, period: { type: 'enum', values: ['month', 'quarter', 'year'], default: 'month' }, target: { type: 'number', required: true, min: 0, maxv: 1e10 } },
    async preview(ctx, a) {
      const cur = (await q(`SELECT target_value FROM stats_goals WHERE company_id = $1 AND metric_key = $2 AND period = $3`, [ctx.cid, a.metric, a.period]).catch(() => []))[0];
      return { rows: [[hu(ctx) ? 'Mutató' : 'Indicator', METRIC[a.metric][ctx.lang]], [hu(ctx) ? 'Időszak' : 'Perioadă', PERIOD[a.period][ctx.lang]], [hu(ctx) ? 'Cél' : 'Țintă', change(cur ? fmtN(num(cur.target_value), 2) : '—', fmtN(a.target, 2))]] };
    },
    async snapshot(ctx, a) {
      const cur = (await q(`SELECT target_value, currency, note FROM stats_goals WHERE company_id = $1 AND metric_key = $2 AND period = $3`, [ctx.cid, a.metric, a.period]))[0];
      return { metric: a.metric, period: a.period, prev: cur || null };
    },
    async undo(ctx, b) {
      if (!b) return { ok: false };
      if (!b.prev) { await q(`DELETE FROM stats_goals WHERE company_id = $1 AND metric_key = $2 AND period = $3`, [ctx.cid, b.metric, b.period]); return { ok: true }; }
      return core.callH(H('statsV2', 'statsGoalSet'), ctx.req, [{ metric_key: b.metric, period: b.period, target_value: b.prev.target_value, currency: b.prev.currency, note: b.prev.note }]);
    },
    async run(ctx, a) {
      const cur = ['revenue', 'profit'].includes(a.metric) ? 'EUR' : null;
      const r = await core.callH(H('statsV2', 'statsGoalSet'), ctx.req, [{ metric_key: a.metric, period: a.period, target_value: a.target, currency: cur }]);
      return r && r.ok ? ok(null, { entity_id: r.id }) : r;
    },
  },
  // ─── Cégbeállítások ───
  {
    name: 'company.settings_update', domain: 'settings', kind: 'write', feature: 'company-settings', roles: ['Admin'],
    title: L('Cégadatok módosítása', 'Modificare date firmă'),
    desc: L('Cégbeállítás módosítása: ' + Object.keys(CS).join(', ') + ' (eur_ron_rate = saját EUR/RON árfolyam, brand_color = #hex).', 'Modifică setările firmei: ' + Object.keys(CS).join(', ') + '.'),
    examples: L(['az IBAN-unk RO49AAAA1B31007593840000', 'a saját árfolyam legyen 4,97'], ['IBAN-ul nostru este RO49AAAA1B31007593840000']),
    params: { eur_ron_rate: { type: 'number', min: 1, maxv: 20 }, iban: { type: 'text', max: 40 }, bank: { type: 'text', max: 120 }, phone: { type: 'text', max: 50 }, email: { type: 'email' },
      website: { type: 'text', max: 200 }, address: { type: 'text', max: 500 }, director: { type: 'text', max: 255 }, reg_com: { type: 'text', max: 30 },
      brand_color: { type: 'text', max: 7 }, waybill_prefix: { type: 'text', max: 10 } },
    async check(ctx, a) {
      if (!Object.keys(CS).some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Melyik cégadatot módosítsam?' : 'Ce dată a firmei modific?', options: [] } };
      if (a.brand_color != null && !/^#[0-9a-fA-F]{6}$/.test(a.brand_color)) return { err: hu(ctx) ? 'A színt #rrggbb formában add meg.' : 'Culoarea în format #rrggbb.' };
      return null;
    },
    async preview(ctx, a) {
      const cur = await core.callH(H('companySettings', 'getCompanySettings'), ctx.req, []);
      if (!cur || cur.ok === false) return { err: (cur && cur.err) || 'Eroare' };
      const rows = [];
      for (const [k, d] of Object.entries(CS)) if (a[k] != null) rows.push([d.l[ctx.lang], change(cur[d.k], a[k])]);
      return { rows };
    },
    async snapshot(ctx, a) {
      const cur = await core.callH(H('companySettings', 'getCompanySettings'), ctx.req, []);
      if (!cur || cur.ok === false) return null;
      const b = { brandColor: cur.brandColor || null, pdfHeaderText: cur.pdfHeaderText || null };
      for (const [k, d] of Object.entries(CS)) if (a[k] != null) b[d.k] = cur[d.k] == null ? null : cur[d.k];
      return b;
    },
    async undo(ctx, b) { return b ? core.callH(H('companySettings', 'saveCompanySettings'), ctx.req, [b]) : { ok: false }; },
    async run(ctx, a) {
      // A mentő a márka-színt és a PDF-fejlécet MINDIG írja → a jelenlegit visszaküldjük.
      const cur = await core.callH(H('companySettings', 'getCompanySettings'), ctx.req, []);
      if (!cur || cur.ok === false) return cur;
      const p = { brandColor: cur.brandColor || null, pdfHeaderText: cur.pdfHeaderText || null };
      for (const [k, d] of Object.entries(CS)) if (a[k] != null) p[d.k] = a[k];
      const r = await core.callH(H('companySettings', 'saveCompanySettings'), ctx.req, [p]);
      return r && r.ok ? ok(null, { entity_id: ctx.cid }) : r;
    },
  },
  // ─── Dokumentum-nyilvántartás ───
  {
    name: 'docs.register_update', domain: 'docs', kind: 'write', feature: 'doc-register',
    title: L('Nyilvántartási bejegyzés módosítása', 'Modificare înregistrare registru'),
    desc: L('Kiadott sorszám (reg_no, pl. FCT-2026-0007) adatainak módosítása: title, partner, amount, currency, notes, date; void = true → sztornó (a szám nem adódik ki újra).', 'Modifică o înregistrare din registru (reg_no): titlu, partener, sumă, notă; void = anulare.'),
    examples: L(['az FCT-2026-0007 partnere a Bilka', 'sztornózd az FCT-2026-0007-et'], ['partenerul FCT-2026-0007 este Bilka', 'anulează FCT-2026-0007']),
    params: { reg_no: { type: 'text', required: true, max: 40 }, title: { type: 'text', max: 255 }, partner: { type: 'text', max: 255 }, amount: { type: 'number', min: 0, maxv: 1e10 },
      currency: { type: 'enum', values: ['EUR', 'RON', 'HUF', 'USD'] }, notes: { type: 'text', max: 2000 }, date: { type: 'date' }, void: { type: 'bool' } },
    async check(ctx, a) {
      if (!['title', 'partner', 'amount', 'currency', 'notes', 'date'].some((k) => a[k] != null) && !a.void) return { ask: { text: hu(ctx) ? 'Mit módosítsak a bejegyzésen?' : 'Ce modific la înregistrare?', options: [] } };
      const e = await findRegEntry(ctx, a.reg_no);
      if (!e) return { err: (hu(ctx) ? 'Nem találok ilyen sorszámot: ' : 'Nu găsesc numărul: ') + a.reg_no };
      if (e.amb) return { ask: { text: hu(ctx) ? 'Melyikre gondolsz?' : 'La care te referi?', options: e.amb.map((n) => ctx.retext(n, a.reg_no)) } };
      a.entry_id = e.id; a.reg_no = e.reg_no;
      return null;
    },
    async preview(ctx, a) {
      const e = (await q(`SELECT * FROM doc_register_entries WHERE id = $1 AND company_id = $2`, [a.entry_id, ctx.cid]))[0];
      if (!e) return { err: 'Înregistrarea nu a fost găsită.' };
      const rows = [[hu(ctx) ? 'Sorszám' : 'Număr', e.reg_no]];
      const add = (lab, o, n) => { if (n != null) rows.push([lab, change(o, n)]); };
      add(hu(ctx) ? 'Dátum' : 'Data', fmtD(d10(e.entry_date)), a.date && fmtD(a.date)); add(hu(ctx) ? 'Cím' : 'Titlu', e.title, a.title); add('Partner', e.partner, a.partner);
      add(hu(ctx) ? 'Összeg' : 'Sumă', e.amount, a.amount); add(hu(ctx) ? 'Pénznem' : 'Monedă', e.currency, a.currency); add(hu(ctx) ? 'Megjegyzés' : 'Notă', e.notes, a.notes);
      if (a.void) rows.push([hu(ctx) ? 'Állapot' : 'Stare', change(e.status, 'void (' + (hu(ctx) ? 'sztornó' : 'anulat') + ')')]);
      return { rows, label: e.reg_no };
    },
    async snapshot(ctx, a) {
      const e = (await q(`SELECT id, entry_date, title, partner, amount, currency, notes, status FROM doc_register_entries WHERE id = $1 AND company_id = $2`, [a.entry_id, ctx.cid]))[0];
      return e ? Object.assign({}, e, { entry_date: d10(e.entry_date) }) : null;
    },
    async undo(ctx, b) { return b ? core.callH(H('documentRegister', 'docRegEntryUpdate'), ctx.req, [b]) : { ok: false }; },
    async run(ctx, a) {
      // A handler minden mezőt felülír → a meglévő értékekkel egészítjük ki.
      const e = (await q(`SELECT * FROM doc_register_entries WHERE id = $1 AND company_id = $2`, [a.entry_id, ctx.cid]))[0];
      if (!e) return { ok: false, err: 'Înregistrarea nu a fost găsită.' };
      const pick = (n, o) => (n != null ? n : o);
      const r = await core.callH(H('documentRegister', 'docRegEntryUpdate'), ctx.req, [{
        id: e.id, entry_date: a.date || d10(e.entry_date), title: pick(a.title, e.title), partner: pick(a.partner, e.partner), amount: pick(a.amount, e.amount),
        currency: pick(a.currency, e.currency), notes: pick(a.notes, e.notes), status: a.void ? 'void' : e.status }]);
      return r && r.ok ? ok(null, { entity_id: e.id }) : r;
    },
  },
];
