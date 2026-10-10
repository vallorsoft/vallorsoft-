// ============================================================
//  VallorSoft — lib/chatTools/settings.js
//  💬 AI-chat 2.0 — 5. kör: ami eddig csak a felületen ment.
//   - e-CMR lista + aláírás (név szerint; rajzolt aláírás a felületen)
//   - e-mail kampány (vizuális sablon + kontaktok): lista, kontakt, kiküldés
//   - GDPR: export (letöltés), anonimizálás, adatvédelmi beállítások
//   - előfizetés: állapot, lemondás, visszavonás
//   - PDF-sablonok, időzített statisztika-riportok, integrációk állapota
//   - megnyitók: CSV-import, üzemanyagkártya-import, PDF aláírás/pecsét,
//     alvállalkozó dokumentumai (feltöltés)
//  Írás MINDIG a meglévő handleren át, company_id-szűrten. Titok (kulcs,
//  jelszó) chatből nem állítható és nem olvasható — csak „be van-e állítva".
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');

const { esc, fmtD } = core.fmt;
const { change, listCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const hu = (ctx) => ctx.lang === 'hu';
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const info = (html) => '<div class="och-info">' + html + '</div>';
const onoff = (ctx, v) => (v ? (hu(ctx) ? '✅ be' : '✅ activ') : (hu(ctx) ? '— ki' : '— inactiv'));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PARTY = { sender: L('Feladó', 'Expeditor'), carrier: L('Fuvarozó', 'Transportator'), consignee: L('Címzett', 'Destinatar') };
const partyL = (ctx, p) => (PARTY[p] ? PARTY[p][ctx.lang] || PARTY[p].hu : p);
const PDF_DOCS = ['order', 'waybill', 'cmr', 'invoice_note'];
const PDF_L = { order: L('Fuvar-lista', 'Listă curse'), waybill: L('Menetlevél', 'Foaie de parcurs'), cmr: L('CMR', 'CMR'), invoice_note: L('Számla-megjegyzés', 'Notă factură') };
const SCHED = ['daily', 'weekly', 'monthly'];
const SCHED_L = { daily: L('naponta', 'zilnic'), weekly: L('hetente', 'săptămânal'), monthly: L('havonta', 'lunar') };

async function findEcmr(ctx, orderId) {
  const r = await q(`SELECT * FROM order_ecmr WHERE company_id = $1 AND order_id = $2 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`, [ctx.cid, orderId]).catch(() => []);
  return r[0] || null;
}
async function findUserRow(ctx, raw) {
  const s = String(raw || '').trim();
  const all = await q(`SELECT id, nume, email, pozicio FROM users WHERE company_id = $1 AND COALESCE(pozicio_dev,false) = false ORDER BY nume`, [ctx.cid]);
  if (s.includes('@')) { const u = all.find((x) => String(x.email).toLowerCase() === s.toLowerCase()); return u ? { u } : { err: (hu(ctx) ? 'Nincs ilyen munkatárs: ' : 'Nu există colegul: ') + s }; }
  const f = core.fmt.fold(s);
  const hits = all.filter((u) => f.split(/\s+/).every((p) => core.fmt.fold(u.nume || '').includes(p)));
  if (hits.length === 1) return { u: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több munkatárs is illik rá — melyik?' : 'Se potrivesc mai mulți colegi — care?', options: hits.slice(0, 5).map((u) => ctx.retext(u.email, s)) } };
  return { err: (hu(ctx) ? 'Nincs ilyen munkatárs: ' : 'Nu există colegul: ') + s };
}
async function findBuilderTpl(ctx, raw) {
  const f = core.fmt.fold(String(raw || '').trim());
  const rows = await q(`SELECT id, name, subject FROM email_builder_templates WHERE company_id = $1 ORDER BY updated_at DESC`, [ctx.cid]);
  const exact = rows.filter((t) => core.fmt.fold(t.name) === f);
  const hits = exact.length ? exact : rows.filter((t) => core.fmt.fold(t.name).includes(f));
  if (hits.length === 1) return { t: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több sablon is illik rá — melyik?' : 'Se potrivesc mai multe șabloane — care?', options: hits.slice(0, 5).map((t) => ctx.retext(t.name, String(raw))) } };
  return { err: (hu(ctx) ? 'Nincs ilyen mentett levél-sablon: ' : 'Nu există șablonul: ') + raw };
}
const splitList = (s) => String(s || '').split(/[,;\n]+|\s+(?:és|es|si|și)\s+/i).map((x) => x.trim()).filter(Boolean);

module.exports = [
  // ─── e-CMR ───
  {
    name: 'ecmr.list', domain: 'docs', kind: 'read', feature: 'ecmr',
    desc: L('Az e-CMR-ek listája (fuvar, állapot, ki írta már alá).', 'Lista e-CMR (cursă, stare, cine a semnat).'),
    async run(ctx) {
      const r = await core.callH(H('ecmr', 'ecmrList'), ctx.req, []);
      const rows = ((r && r.items) || []).map((x) => ({ order: x.order_id, route: [x.loc_incarcare, x.loc_descarcare].filter(Boolean).join(' → '), status: x.status,
        sig: ['sender', 'carrier', 'consignee'].map((p) => (x[p + '_signed_at'] ? '✅' : '○') + ' ' + partyL(ctx, p)).join(' · ') }));
      return { reply: hu(ctx) ? rows.length + ' e-CMR.' : rows.length + ' e-CMR.', html: info(listCard(ctx, '📝', 'e-CMR', rows,
        [{ k: 'order', l: L('Fuvar', 'Cursa') }, { k: 'route', l: L('Útvonal', 'Traseu') }, { k: 'status', l: L('Állapot', 'Stare') }, { k: 'sig', l: L('Aláírások', 'Semnături') }], 60)) };
    },
  },
  {
    name: 'ecmr.sign', domain: 'docs', kind: 'write', feature: 'ecmr',
    title: L('e-CMR aláírása', 'Semnare e-CMR'),
    desc: L('Egy fuvar e-CMR-jének aláírása név szerint: order, party (sender|carrier|consignee), name (az aláíró neve). Rajzolt aláíráshoz az e-CMR oldal nyílik meg (draw=igen).', 'Semnează e-CMR-ul unei curse cu numele semnatarului.'),
    examples: L(['írd alá a 0042 e-CMR-jét fuvarozóként Gondos Imre nevén'], ['semnează e-CMR 0042 ca transportator, Gondos Imre']),
    params: { order: { type: 'order', required: true, fromHistory: true }, party: { type: 'enum', values: ['sender', 'carrier', 'consignee'], required: true },
      name: { type: 'text', max: 200 }, draw: { type: 'bool', default: false } },
    async check(ctx, a) {
      a.e = await findEcmr(ctx, a.order.id);
      if (!a.e) return { err: hu(ctx) ? 'Ennek a fuvarnak nincs e-CMR-je — előbb hozd létre („készíts e-CMR-t a ' + a.order.no + '-hoz").' : 'Cursa nu are e-CMR — creează-l întâi.' };
      if (a.e[a.party + '_signed_at']) return { err: (hu(ctx) ? 'Ezt a részt már aláírták: ' : 'Partea este deja semnată: ') + partyL(ctx, a.party) + ' (' + (a.e[a.party + '_name'] || '') + ')' };
      if (!a.draw && !a.name) return { ask: { text: hu(ctx) ? 'Ki írja alá (név)?' : 'Cine semnează (nume)?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      if (a.draw) return { rows: [['#', a.order.no], [hu(ctx) ? 'Fél' : 'Parte', partyL(ctx, a.party)], [hu(ctx) ? 'Mód' : 'Mod', hu(ctx) ? 'rajzolt aláírás az e-CMR oldalon' : 'semnătură desenată în pagina e-CMR']], label: a.order.no };
      return { rows: [['#', a.order.no], [hu(ctx) ? 'Fél' : 'Parte', partyL(ctx, a.party)], [hu(ctx) ? 'Aláíró' : 'Semnatar', a.name], [hu(ctx) ? 'Időpont' : 'Data', hu(ctx) ? 'most (IP-vel rögzítve)' : 'acum (cu IP)']], label: a.order.no };
    },
    async run(ctx, a) {
      if (a.draw) return ok(hu(ctx) ? 'Megnyitottam az e-CMR oldalt — ott rajzolhatod meg az aláírást.' : 'Am deschis pagina e-CMR — acolo poți desena semnătura.', { ui: { op: 'tab', tab: 'ecmr' } });
      const r = await core.callH(H('ecmr', 'ecmrSign'), ctx.req, [{ ecmr_id: a.e.id, party: a.party, name: a.name, sig: null }]);
      return r && r.ok ? ok((hu(ctx) ? '✅ Aláírva. Az e-CMR állapota: ' : '✅ Semnat. Starea e-CMR: ') + r.status, { entity_id: a.e.id }) : r;
    },
  },
  // ─── E-mail kampány (vizuális sablonok) ───
  {
    name: 'campaign.templates', domain: 'mail', kind: 'read', feature: 'email-builder',
    desc: L('Az e-mail szerkesztőben mentett (vizuális) levél-sablonok és hány kontakthoz vannak párosítva.', 'Șabloanele vizuale de e-mail salvate.'),
    async run(ctx) {
      const r = await core.callH(H('emailBuilder', 'ebTemplateList'), ctx.req, []);
      const rows = (r && r.templates) || [];
      return { reply: hu(ctx) ? rows.length + ' mentett levél-sablon.' : rows.length + ' șabloane salvate.', html: info(listCard(ctx, '🎨', hu(ctx) ? 'Levél-sablonok' : 'Șabloane e-mail', rows,
        [{ k: 'name', l: L('Név', 'Nume') }, { k: 'subject', l: L('Tárgy', 'Subiect') }, { k: 'pairing_count', l: L('Párosított kontakt', 'Contacte asociate') }])) };
    },
  },
  {
    name: 'campaign.contacts', domain: 'mail', kind: 'read', feature: 'email-builder',
    desc: L('A kampány-kontaktok listája (név, e-mail, típus).', 'Lista contactelor pentru campanii.'),
    async run(ctx) {
      const r = await core.callH(H('emailBuilder', 'ebContactList'), ctx.req, []);
      const rows = (r && r.contacts) || [];
      return { reply: hu(ctx) ? rows.length + ' kontakt.' : rows.length + ' contacte.', html: info(listCard(ctx, '📇', hu(ctx) ? 'Kontaktok' : 'Contacte', rows,
        [{ k: 'name', l: L('Név', 'Nume') }, { k: 'email', l: L('E-mail', 'E-mail') }, { k: 'type', l: L('Típus', 'Tip') }], 80)) };
    },
  },
  {
    name: 'campaign.contact_add', domain: 'mail', kind: 'write', feature: 'email-builder',
    title: L('Új kampány-kontakt', 'Contact nou'),
    desc: L('Kontakt felvétele a kampány-listára: name, email, type (ugyfel|alvalalkozo|egyeb), notes.', 'Adaugă un contact pentru campanii.'),
    params: { name: { type: 'text', required: true, max: 160 }, email: { type: 'email', required: true }, type: { type: 'enum', values: ['ugyfel', 'alvalalkozo', 'egyeb'], default: 'ugyfel' }, notes: { type: 'text', max: 500 } },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Név' : 'Nume', a.name], ['E-mail', a.email], [hu(ctx) ? 'Típus' : 'Tip', a.type]], label: a.name }; },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('emailBuilder', 'ebContactDelete'), ctx.req, [{ id: res.id }]) : { ok: false }; },
    async run(ctx, a) { const r = await core.callH(H('emailBuilder', 'ebContactSave'), ctx.req, [{ name: a.name, email: a.email, type: a.type, notes: a.notes }]); return r && r.ok ? ok(null, { id: r.id, entity_id: r.id || null }) : r; },
  },
  {
    name: 'campaign.send', domain: 'mail', kind: 'danger', feature: 'email-builder',
    title: L('E-mail kampány kiküldése', 'Trimitere campanie e-mail'),
    desc: L('Mentett vizuális levél-sablon kiküldése a cég feladó-fiókjáról: template (sablon neve), to = „párosítottak” (a sablonhoz párosított kontaktok) | „mindenki” (összes kontakt) | kontakt-nevek / e-mail címek vesszővel. Max 200 címzett.', 'Trimite un șablon vizual către contacte.'),
    examples: L(['küldd ki az Októberi akció sablont a párosított kontaktoknak'], ['trimite șablonul Ofertă octombrie contactelor asociate']),
    params: { template: { type: 'text', required: true, max: 160 }, to: { type: 'text', max: 2000, default: 'paired' } },
    async check(ctx, a) {
      const f = await findBuilderTpl(ctx, a.template); if (f.err || f.ask) return f;
      a.t = f.t;
      const s = core.fmt.fold(String(a.to || '')).trim();
      a.contact_ids = []; a.extra = []; a.mode = 'list';
      if (!s || /^(paired|parositott|parositottak|asociate|asociati)/.test(s)) a.mode = 'paired';
      else if (/^(all|mindenki|mindenkinek|osszes|toti|toate|tuturor)/.test(s)) a.mode = 'all';
      if (a.mode === 'all') a.contact_ids = (await q(`SELECT id FROM email_contacts WHERE company_id = $1`, [ctx.cid])).map((x) => x.id);
      if (a.mode === 'list') {
        const contacts = await q(`SELECT id, name, email FROM email_contacts WHERE company_id = $1`, [ctx.cid]);
        for (const p of splitList(a.to)) {
          if (EMAIL_RE.test(p)) { a.extra.push(p.toLowerCase()); continue; }
          const fp = core.fmt.fold(p);
          const hits = contacts.filter((c) => core.fmt.fold(c.name).includes(fp));
          if (hits.length !== 1) return { err: (hu(ctx) ? (hits.length ? 'Több kontakt is illik rá: ' : 'Nincs ilyen kontakt: ') : (hits.length ? 'Se potrivesc mai multe contacte: ' : 'Nu există contactul: ')) + p };
          a.contact_ids.push(hits[0].id);
        }
      }
      if (a.mode === 'paired') a.n = ((await q(`SELECT COUNT(*)::int AS n FROM email_template_pairings WHERE template_id = $1 AND company_id = $2`, [a.t.id, ctx.cid]))[0] || {}).n || 0;
      else a.n = new Set(a.contact_ids).size + new Set(a.extra).size;
      if (!a.n) return { err: hu(ctx) ? 'Nincs címzett — párosíts kontaktot a sablonhoz, vagy add meg a címzetteket.' : 'Nu există destinatari.' };
      if (a.n > 200) return { err: hu(ctx) ? 'Legfeljebb 200 címzett küldhető egyszerre.' : 'Maxim 200 de destinatari odată.' };
      return null;
    },
    async preview(ctx, a) {
      const who = a.mode === 'paired' ? (hu(ctx) ? 'a sablonhoz párosított kontaktok' : 'contactele asociate') : a.mode === 'all' ? (hu(ctx) ? 'összes kontakt' : 'toate contactele') : (hu(ctx) ? 'kiválasztottak' : 'selectați');
      return { rows: [[hu(ctx) ? 'Sablon' : 'Șablon', a.t.name], [hu(ctx) ? 'Tárgy' : 'Subiect', a.t.subject || '—'], [hu(ctx) ? 'Címzettek' : 'Destinatari', who + ' · ' + a.n]], label: a.t.name };
    },
    async run(ctx, a) {
      const r = await core.callH(H('emailBuilder', 'ebSend'), ctx.req, [{ template_id: a.t.id, contact_ids: a.mode === 'paired' ? [] : a.contact_ids, extra_emails: a.extra }]);
      if (!r || !r.ok) return r;
      const nf = (r.errors || []).length;
      return ok((hu(ctx) ? '✅ Kiküldve: ' : '✅ Trimis: ') + (r.sent != null ? r.sent : a.n) + (nf ? (hu(ctx) ? ' · sikertelen: ' : ' · eșuate: ') + nf : ''));
    },
  },
  // ─── GDPR ───
  {
    name: 'gdpr.export', domain: 'settings', kind: 'ui', roles: ['Admin'],
    desc: L('A cég teljes adat-exportja (GDPR, JSON letöltés). Csak Admin.', 'Exportul complet al datelor firmei (GDPR, descărcare JSON).'),
    async run(ctx) { return { reply: hu(ctx) ? 'Indul az export letöltése…' : 'Pornește descărcarea exportului…', ui: { op: 'gdprExport' } }; },
  },
  {
    name: 'gdpr.anonymize', domain: 'settings', kind: 'danger', roles: ['Admin'],
    title: L('Munkatárs anonimizálása (GDPR)', 'Anonimizare coleg (GDPR)'),
    desc: L('Volt munkatárs személyes adatainak végleges törlése (név, e-mail, telefon → anonim; letiltva). A fuvar-archívum megmarad. user = név vagy e-mail. Csak Admin.', 'Anonimizează definitiv datele personale ale unui fost coleg.'),
    params: { user: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) {
      const f = await findUserRow(ctx, a.user); if (f.err || f.ask) return f;
      if (f.u.id === ctx.user.id) return { err: hu(ctx) ? 'Saját magadat nem anonimizálhatod.' : 'Nu te poți anonimiza pe tine.' };
      a.u = f.u; return null;
    },
    async preview(ctx, a) { return { rows: [['👤', a.u.nume], ['E-mail', a.u.email], [hu(ctx) ? 'Hatás' : 'Efect', hu(ctx) ? 'név/e-mail/telefon törlése, fiók letiltása' : 'șterge nume/e-mail/telefon, blochează contul']], label: a.u.nume }; },
    async run(ctx, a) { const r = await core.callH(H('gdpr', 'anonymizeUser'), ctx.req, [a.u.id]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'gdpr.settings', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Adatvédelmi beállítások', 'Setări protecția datelor'),
    desc: L('Adatvédelmi (GDPR) beállítások módosítása — a többi megmarad: notice (sofőr-tájékoztató szövege), dpo (DPO elérhetőség), gps_business_only (GPS csak üzleti célra), retention (megőrzési megjegyzés). Csak Admin.', 'Modifică setările GDPR.'),
    params: { notice: { type: 'text', max: 8000 }, dpo: { type: 'text', max: 500 }, gps_business_only: { type: 'bool' }, retention: { type: 'text', max: 2000 } },
    async check(ctx, a) {
      if (a.notice == null && a.dpo == null && a.gps_business_only == null && a.retention == null) return { ask: { text: hu(ctx) ? 'Mit módosítsak?' : 'Ce modific?', options: [] } };
      const r = await core.callH(H('gdpr', 'getGdprSettings'), ctx.req, []);
      a.cur = (r && r.settings) || {};
      return null;
    },
    async preview(ctx, a) {
      const c = a.cur; const rows = [];
      if (a.notice != null) rows.push([hu(ctx) ? 'Tájékoztató' : 'Informare', change(String(c.privacy_notice || '').slice(0, 80), a.notice.slice(0, 80))]);
      if (a.dpo != null) rows.push(['DPO', change(c.dpo_contact, a.dpo)]);
      if (a.gps_business_only != null) rows.push([hu(ctx) ? 'GPS csak üzleti célra' : 'GPS doar în scop de serviciu', change(onoff(ctx, c.gps_business_only), onoff(ctx, a.gps_business_only))]);
      if (a.retention != null) rows.push([hu(ctx) ? 'Megőrzés' : 'Păstrare', change(c.retention_note, a.retention)]);
      return { rows, label: 'GDPR' };
    },
    async snapshot(ctx, a) { return { c: a.cur }; },
    async undo(ctx, b) { const c = (b && b.c) || {}; return core.callH(H('gdpr', 'saveGdprSettings'), ctx.req, [{ privacy_notice: c.privacy_notice, dpo_contact: c.dpo_contact, gps_business_only: c.gps_business_only, retention_note: c.retention_note }]); },
    async run(ctx, a) {
      const c = a.cur;
      // Az írás után a sofőröknek újra vissza kell igazolniuk a tájékoztatót (meglévő logika).
      const r = await core.callH(H('gdpr', 'saveGdprSettings'), ctx.req, [{ privacy_notice: a.notice != null ? a.notice : c.privacy_notice, dpo_contact: a.dpo != null ? a.dpo : c.dpo_contact,
        gps_business_only: a.gps_business_only != null ? a.gps_business_only : c.gps_business_only, retention_note: a.retention != null ? a.retention : c.retention_note }]);
      return r && r.ok ? ok(null) : r;
    },
  },
  // ─── Előfizetés ───
  {
    name: 'subscription.status', domain: 'settings', kind: 'read', roles: ['Admin'],
    desc: L('Az előfizetés állapota (csomag, meddig fizetett, hány nap van hátra, lemondás folyamatban-e). Csak Admin.', 'Starea abonamentului.'),
    async run(ctx) {
      const r = await core.callH(H('billingHandlers', 'getMySubscription'), ctx.req, []);
      if (!r || !r.ok) return r;
      const rows = [{ k: hu(ctx) ? 'Csomag' : 'Pachet', v: r.plan_name || '—' }, { k: hu(ctx) ? 'Állapot' : 'Stare', v: r.status }, { k: hu(ctx) ? 'Fizetve eddig' : 'Plătit până', v: r.paid_until ? fmtD(d10(r.paid_until)) : '—' },
        { k: hu(ctx) ? 'Hátralévő nap' : 'Zile rămase', v: r.days_left != null ? String(r.days_left) : '—' }, { k: hu(ctx) ? 'Lemondva' : 'Anulat', v: r.cancel_pending ? (hu(ctx) ? 'igen — ' : 'da — ') + fmtD(d10(r.paid_until)) + (hu(ctx) ? '-ig él' : ' rămâne activ') : (hu(ctx) ? 'nem' : 'nu') }];
      return { reply: hu(ctx) ? 'Az előfizetésed állapota.' : 'Starea abonamentului.', html: info(listCard(ctx, '💳', hu(ctx) ? 'Előfizetés' : 'Abonament', rows, [{ k: 'k', l: L('', '') }, { k: 'v', l: L('', '') }])) };
    },
  },
  {
    name: 'subscription.cancel', domain: 'settings', kind: 'danger', roles: ['Admin'],
    title: L('Előfizetés lemondása', 'Anulare abonament'),
    desc: L('Az előfizetés lemondása: a hozzáférés a már kifizetett időszak végéig megmarad, utána megszűnik. Visszavonható: subscription.reactivate. Csak Admin.', 'Anulează abonamentul (accesul rămâne până la finalul perioadei plătite).'),
    async check(ctx, a) {
      const r = await core.callH(H('billingHandlers', 'getMySubscription'), ctx.req, []);
      if (!r || !r.ok) return { err: (r && r.err) || 'Eroare' };
      if (r.cancel_pending) return { err: hu(ctx) ? 'Az előfizetés már le van mondva.' : 'Abonamentul este deja anulat.' };
      if (!r.can_cancel) return { err: hu(ctx) ? 'Az előfizetés most nem mondható le (nincs aktív, fizetett időszak).' : 'Abonamentul nu poate fi anulat acum.' };
      a.until = r.paid_until; a.plan = r.plan_name;
      return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Csomag' : 'Pachet', a.plan || '—'], [hu(ctx) ? 'Hozzáférés eddig' : 'Acces până la', a.until ? fmtD(d10(a.until)) : '—']], label: a.plan || '' }; },
    async run(ctx) { const r = await core.callH(H('billingHandlers', 'cancelSubscription'), ctx.req, []); return r && r.ok ? ok(hu(ctx) ? '✅ Lemondva. A hozzáférés a fizetett időszak végéig megmarad; e-mailben is kaptál egy visszavonó linket.' : '✅ Anulat. Accesul rămâne până la finalul perioadei plătite.') : r; },
  },
  {
    name: 'subscription.reactivate', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Lemondás visszavonása', 'Anularea renunțării'),
    desc: L('A folyamatban lévő előfizetés-lemondás visszavonása. Csak Admin.', 'Revocă anularea abonamentului.'),
    async check(ctx) {
      const r = await core.callH(H('billingHandlers', 'getMySubscription'), ctx.req, []);
      if (!r || !r.ok) return { err: (r && r.err) || 'Eroare' };
      if (!r.cancel_pending) return { err: hu(ctx) ? 'Nincs folyamatban lévő lemondás.' : 'Nu există o anulare în curs.' };
      return null;
    },
    async preview(ctx) { return { rows: [[hu(ctx) ? 'Előfizetés' : 'Abonament', hu(ctx) ? 'folytatódik' : 'continuă']] }; },
    async run(ctx) { const r = await core.callH(H('billingHandlers', 'reactivateSubscription'), ctx.req, []); return r && r.ok ? ok(null) : r; },
  },
  // ─── PDF-sablonok ───
  {
    name: 'pdf_template.update', domain: 'settings', kind: 'write', roles: ['Admin'], feature: 'pdf-settings',
    title: L('PDF-sablon', 'Șablon PDF'),
    desc: L('PDF-dokumentum fejléc/lábléc/szín/logó beállítása (a többi megmarad): doc (' + PDF_DOCS.join('|') + '), header, footer, color (#rrggbb), logo (igen/nem). Csak Admin.', 'Setează antetul / subsolul / culoarea unui document PDF.'),
    examples: L(['a menetlevél láblécébe kerüljön: Köszönjük a munkát!'], ['în subsolul foii de parcurs: Mulțumim!']),
    params: { doc: { type: 'enum', values: PDF_DOCS, required: true }, header: { type: 'text', max: 600 }, footer: { type: 'text', max: 600 }, color: { type: 'text', max: 9 }, logo: { type: 'bool' } },
    async check(ctx, a) {
      if (a.header == null && a.footer == null && a.color == null && a.logo == null) return { ask: { text: hu(ctx) ? 'Mit módosítsak a PDF-en (fejléc, lábléc, szín, logó)?' : 'Ce modific (antet, subsol, culoare, logo)?', options: [] } };
      if (a.color != null && !/^#?[0-9a-f]{6}$/i.test(a.color)) return { err: hu(ctx) ? 'A szín #rrggbb formátumú legyen (pl. #f6711e).' : 'Culoarea trebuie să fie #rrggbb.' };
      if (a.color && a.color[0] !== '#') a.color = '#' + a.color;
      const r = await core.callH(H('pdfTemplates', 'pdfTemplateGet'), ctx.req, [a.doc]);
      a.cur = (r && r.template) || {};
      return null;
    },
    async preview(ctx, a) {
      const c = a.cur; const rows = [[hu(ctx) ? 'Dokumentum' : 'Document', (PDF_L[a.doc][ctx.lang] || a.doc)]];
      if (a.header != null) rows.push([hu(ctx) ? 'Fejléc' : 'Antet', change(c.header_text, a.header)]);
      if (a.footer != null) rows.push([hu(ctx) ? 'Lábléc' : 'Subsol', change(c.footer_text, a.footer)]);
      if (a.color != null) rows.push([hu(ctx) ? 'Szín' : 'Culoare', change(c.accent_color, a.color)]);
      if (a.logo != null) rows.push(['Logo', change(onoff(ctx, c.show_logo), onoff(ctx, a.logo))]);
      return { rows, label: a.doc };
    },
    async snapshot(ctx, a) { return { c: a.cur, doc: a.doc }; },
    async undo(ctx, b) { const c = b && b.c; return c ? core.callH(H('pdfTemplates', 'pdfTemplateSave'), ctx.req, [{ docType: b.doc, headerText: c.header_text, footerText: c.footer_text, accentColor: c.accent_color, showLogo: c.show_logo }]) : { ok: false }; },
    async run(ctx, a) {
      const c = a.cur;
      const r = await core.callH(H('pdfTemplates', 'pdfTemplateSave'), ctx.req, [{ docType: a.doc, headerText: a.header != null ? a.header : c.header_text, footerText: a.footer != null ? a.footer : c.footer_text,
        accentColor: a.color != null ? a.color : c.accent_color, showLogo: a.logo != null ? a.logo : c.show_logo }]);
      return r && r.ok ? ok(null) : r;
    },
  },
  // ─── Időzített statisztika-riportok ───
  {
    name: 'stats_report.list', domain: 'stats', kind: 'read', feature: 'stats-v2',
    desc: L('Az időzített e-mail statisztika-riportok listája.', 'Lista rapoartelor statistice programate.'),
    async run(ctx) {
      const r = await core.callH(H('statsReports', 'statsReportScheduleList'), ctx.req, []);
      const rows = ((r && r.schedules) || []).map((s) => ({ name: s.name, sched: SCHED_L[s.schedule] ? SCHED_L[s.schedule][ctx.lang] : s.schedule, to: (s.recipients || []).join(', '), on: s.enabled, last: s.last_run_at ? fmtD(d10(s.last_run_at)) : '—' }));
      return { reply: hu(ctx) ? rows.length + ' időzített riport.' : rows.length + ' rapoarte programate.', html: info(listCard(ctx, '📧', hu(ctx) ? 'Időzített riportok' : 'Rapoarte programate', rows,
        [{ k: 'name', l: L('Név', 'Nume') }, { k: 'sched', l: L('Gyakoriság', 'Frecvență') }, { k: 'to', l: L('Címzettek', 'Destinatari') }, { k: 'on', l: L('Állapot', 'Stare'), f: (v) => onoff(ctx, v) }, { k: 'last', l: L('Utoljára', 'Ultima') }])) };
    },
  },
  {
    name: 'stats_report.save', domain: 'stats', kind: 'write', feature: 'stats-v2', roles: ['Admin'],
    title: L('Időzített riport', 'Raport programat'),
    desc: L('Időzített statisztika-riport e-mailben (előző havi KPI-k): name, schedule (daily|weekly|monthly), recipients (e-mail címek vesszővel), enabled. Meglévő név → módosítás. Csak Admin.', 'Creează / modifică un raport statistic programat.'),
    examples: L(['küldj havonta riportot a fonok@ceg.ro címre'], ['trimite lunar raport la sef@firma.ro']),
    params: { name: { type: 'text', max: 120 }, schedule: { type: 'enum', values: SCHED, default: 'monthly' }, recipients: { type: 'text', required: true, max: 2000 }, enabled: { type: 'bool', default: true } },
    async check(ctx, a) {
      a.list = splitList(a.recipients).filter((e) => EMAIL_RE.test(e)).slice(0, 20);
      if (!a.list.length) return { ask: { text: hu(ctx) ? 'Kinek menjen (e-mail cím)?' : 'Cui să fie trimis (e-mail)?', options: [] } };
      a.name = a.name || (hu(ctx) ? 'Havi riport' : 'Raport lunar');
      a.ex = ((await q(`SELECT id FROM stats_report_schedules WHERE company_id = $1 AND LOWER(name) = LOWER($2)`, [ctx.cid, a.name]))[0] || {}).id || null;
      return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Név' : 'Nume', a.name + (a.ex ? (hu(ctx) ? ' (módosítás)' : ' (modificare)') : '')], [hu(ctx) ? 'Gyakoriság' : 'Frecvență', SCHED_L[a.schedule][ctx.lang]], [hu(ctx) ? 'Címzettek' : 'Destinatari', a.list.join(', ')], [hu(ctx) ? 'Állapot' : 'Stare', onoff(ctx, a.enabled)]], label: a.name }; },
    async run(ctx, a) { const r = await core.callH(H('statsReports', 'statsReportScheduleSave'), ctx.req, [{ id: a.ex, name: a.name, schedule: a.schedule, recipients: a.list, enabled: a.enabled }]); return r && r.ok ? ok(null, { entity_id: r.id || a.ex }) : r; },
  },
  {
    name: 'stats_report.delete', domain: 'stats', kind: 'write', feature: 'stats-v2', roles: ['Admin'],
    title: L('Időzített riport törlése', 'Ștergere raport programat'),
    desc: L('Időzített riport törlése: name. Csak Admin.', 'Șterge un raport programat.'),
    params: { name: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) {
      const r = await q(`SELECT id, name FROM stats_report_schedules WHERE company_id = $1 AND LOWER(name) LIKE LOWER($2)`, [ctx.cid, '%' + a.name + '%']);
      if (!r.length) return { err: (hu(ctx) ? 'Nincs ilyen riport: ' : 'Nu există raportul: ') + a.name };
      if (r.length > 1) return { ask: { text: hu(ctx) ? 'Melyiket?' : 'Care?', options: r.slice(0, 5).map((x) => ctx.retext(x.name, a.name)) } };
      a.s = r[0]; return null;
    },
    async preview(ctx, a) { return { rows: [['📧', a.s.name]], label: a.s.name }; },
    async run(ctx, a) { const r = await core.callH(H('statsReports', 'statsReportScheduleDelete'), ctx.req, [a.s.id]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Integrációk állapota (titok nélkül) ───
  {
    name: 'integrations.status', domain: 'settings', kind: 'read', roles: ['Admin'],
    desc: L('Mely integrációk vannak beállítva (számlázó, GPS, e-mail feladó, beérkező megrendelés-postafiók, postafiókok, térkép) — kulcsok nélkül. Beállításuk a felületen (Integrációk). Csak Admin.', 'Ce integrări sunt configurate (fără chei).'),
    async run(ctx) {
      const bi = await q(`SELECT display_name, provider, is_active FROM billing_integrations WHERE company_id = $1`, [ctx.cid]).catch(() => []);
      const ci = await q(`SELECT provider, category, enabled, status FROM company_integrations WHERE company_id = $1`, [ctx.cid]).catch(() => []);
      const mb = await q(`SELECT COUNT(*)::int AS n FROM mail_accounts WHERE company_id = $1`, [ctx.cid]).catch(() => [{ n: 0 }]);
      const NAME = { cargotrack: 'GPS — CargoTrack', fomco: 'GPS — Fomco', email_sender: hu(ctx) ? 'E-mail feladó-fiók' : 'Cont expeditor e-mail', email_intake: hu(ctx) ? 'Megrendelés-postafiók (AI)' : 'Căsuță comenzi (AI)', maps: hu(ctx) ? 'Térkép (HERE/Google)' : 'Hărți (HERE/Google)' };
      const rows = bi.map((b) => ({ n: (hu(ctx) ? 'Számlázó — ' : 'Facturare — ') + (b.display_name || b.provider), on: !!b.is_active, st: '' }))
        .concat(ci.filter((c) => NAME[c.provider] || c.category === 'gps').map((c) => ({ n: NAME[c.provider] || c.provider, on: !!c.enabled, st: c.status || '' })))
        .concat([{ n: hu(ctx) ? 'Levelek — postafiókok' : 'E-mail — căsuțe', on: (mb[0] || {}).n > 0, st: String((mb[0] || {}).n || 0) }]);
      return { reply: hu(ctx) ? 'Az integrációk állapota (a kulcsokat csak a felületen lehet beállítani).' : 'Starea integrărilor (cheile se setează doar în interfață).',
        html: info(listCard(ctx, '🔌', hu(ctx) ? 'Integrációk' : 'Integrări', rows, [{ k: 'n', l: L('Integráció', 'Integrare') }, { k: 'on', l: L('Állapot', 'Stare'), f: (v) => onoff(ctx, v) }, { k: 'st', l: L('Megjegyzés', 'Notă') }])) };
    },
  },
  // ─── Megnyitók (fájl kell / rajzolni kell → a felület) ───
  {
    name: 'open.order_import', domain: 'orders', kind: 'ui', feature: 'orders-import',
    desc: L('Fuvarok tömeges importja CSV-ből — megnyitja az import-ablakot (a fájlt ott kell kiválasztani).', 'Deschide importul de curse din CSV.'),
    examples: L(['importálni szeretnék fuvarokat Excelből'], ['vreau să import curse din CSV']),
    async run(ctx) { return { reply: hu(ctx) ? 'Megnyitottam a fuvar-importot — válaszd ki a CSV-fájlt.' : 'Am deschis importul — alege fișierul CSV.', ui: { op: 'orderImport' } }; },
  },
  {
    name: 'open.fuel_import', domain: 'fleet', kind: 'ui', feature: 'fuel-import',
    desc: L('Üzemanyagkártya-kivonat importja — megnyitja az oldalt (a fájlt ott kell kiválasztani).', 'Deschide importul extrasului de card de combustibil.'),
    async run(ctx) { return { reply: hu(ctx) ? 'Megnyitottam az üzemanyagkártya-importot.' : 'Am deschis importul cardului de combustibil.', ui: { op: 'tab', tab: 'fuel-import' } }; },
  },
  {
    name: 'open.sign_pdf', domain: 'docs', kind: 'ui', feature: 'signature',
    desc: L('PDF aláírása / lepecsételése — megnyitja az Aláírás és pecsét oldalt (feltöltés + rajzolás ott).', 'Deschide pagina de semnare / ștampilare PDF.'),
    examples: L(['pecsételni szeretnék egy PDF-et'], ['vreau să ștampilez un PDF']),
    async run(ctx) { return { reply: hu(ctx) ? 'Megnyitottam az Aláírás és pecsét oldalt.' : 'Am deschis pagina Semnătură și ștampilă.', ui: { op: 'tab', tab: 'signature' } }; },
  },
  {
    name: 'carrier.docs', domain: 'carriers', kind: 'ui', feature: 'external-drivers',
    desc: L('Egy alvállalkozó dokumentumai — megnyitja az ablakot, ahol letölthetők és új dokumentum tölthető fel neki.', 'Deschide documentele subcontractorului (descărcare + încărcare).'),
    examples: L(['töltsünk fel egy CMR-t a Rapid Kft-nek'], ['încarcă un CMR pentru Rapid SRL']),
    params: { carrier: { type: 'carrier', required: true } },
    async run(ctx, a) { return { reply: (hu(ctx) ? 'Megnyitottam a dokumentumait: ' : 'Am deschis documentele: ') + a.carrier.name, ui: { op: 'carrierDocs', id: String(a.carrier.id) } }; },
  },
];
