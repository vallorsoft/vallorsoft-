// ============================================================
//  VallorSoft — lib/chatOps.js
//  💬 A szöveges fuvarkiírás chat bővítései (AI NÉLKÜL, determinisztikusan):
//   1) Műveletek MEGERŐSÍTÉSSEL — „Rendeld Petőhöz a CMD-2026-0042-t",
//      „jelöld fizetettnek", „állítsd lezártra", „a felrakás holnapra csúszik",
//      „az ára 1200 EUR legyen". A chat egy kártyán megmutatja, MI fog
//      változni, és csak a ✅ gombra hajtja végre — a MEGLÉVŐ handlerekkel
//      (comUpdate / plannerAssign / markOrderPayment / quoteSave).
//   2) Cégszintű kérdések — napi teendők, ki tartozik, ügyfél-helyzet,
//      lejáró dokumentumok, esedékes szerviz.
//   3) Kiosztási javaslat — „Ki vihetné a CMD-0050-et?" (Visszfuvar-radar).
//   4) Árajánlat — „Mennyibe kerülne Kolozsvárról Budapestre 13 t?"
//   5) Üzenet a sofőrnek — WhatsApp-link előre kitöltött szöveggel.
//   6) Napi összefoglaló a chat megnyitásakor (`brief`).
//
//  Biztonság:
//   • A művelet-kártya egy HMAC-aláírt tokent hordoz (típus + paraméterek +
//     cég + felhasználó + lejárat 15 perc) — a kliens nem tud más műveletet
//     „becsempészni". Végrehajtáskor a meglévő handler UGYANAZZAL a req-gel
//     fut → a szerep- és cég-ellenőrzés (company_id) ott is megtörténik.
//   • Minden lekérdezés company_id-szűrt, paraméteres; a kártya szerveren,
//     escape-elve renderelődik; az AI semmilyen adatot nem kap.
// ============================================================
'use strict';

const crypto = require('crypto');
const pool = require('../db');
const mi = require('./mailIntent');
const di = require('./driverInfo');

const H = di._h;
const { esc, fmtD, fmtDT, fmtN, num, iso, plateNorm, cityOf, tiles, table, section, findEntity } = H;
const fold = mi.fold;

// ─── Szövegek ───
const T = {
  hu: {
    confirm: '✅ Megerősítés', cancel: '✕ Mégse', confirmQ: 'Ezt fogom végrehajtani — megerősíted?',
    assign: 'Kiosztás', status: 'Státusz-váltás', pay: 'Fizetés rögzítése', date: 'Dátum-módosítás', price: 'Ár-módosítás',
    driver: 'Sofőr', vehicle: 'Jármű', none: '—', from: 'Most', to: 'Új', amount: 'Összeg',
    loadDate: 'Felrakás dátuma', unloadDate: 'Lerakás dátuma', orderPrice: 'Fuvardíj',
    noOrder: 'Melyik fuvarra gondolsz? Írd be a fuvarszámot (pl. CMD-2026-0042).',
    orderNotFound: (r) => 'Nem találom a(z) ' + r + ' fuvart.',
    whoAssign: 'Kinek / melyik járműnek osszam ki? Írd be a sofőr nevét vagy a rendszámot.',
    notFinal: 'Fizetést csak lezárt (Finalizat) fuvarra lehet rögzíteni.',
    alreadyPaid: 'Ez a fuvar már teljesen ki van fizetve.',
    sameStatus: 'A fuvar már ebben a státuszban van.',
    st: { Finalizat: 'Lezárva', 'In Curs': 'Úton', Disponibil: 'Kiosztásra vár', Alocat: 'Kiosztva', Extern: 'Alvállalkozó', Parkolt: 'Leadva (pótkocsin)', Raktarban: 'Raktárban', Anulat: 'Törölve' },
    done: '✅ Kész.', expired: 'A megerősítés lejárt — kérd újra.', badToken: 'Érvénytelen művelet.',
    // javaslat
    suggestTitle: 'Kiosztási javaslat', suggestNone: 'Nincs olyan kamion, amelyik a közelben szabad lenne — a radar nem talált javaslatot.',
    freeDrivers: 'Szabad sofőrök (most nincs aktív fuvarjuk)', assignThis: '➕ Erre osztom ki', km: 'km', overlap: '⚠️ átfedés',
    live: '📍 élő GPS', freeFrom: 'szabad', alreadyAssigned: (p) => 'Ez a fuvar már ki van osztva (' + p + ').',
    // cég
    briefTitle: 'Mai összefoglaló', active: 'Aktív fuvar', todayLoad: 'Mai felrakás', todayUnload: 'Mai lerakás', late: 'Késésben',
    waiting: 'Kiosztásra vár', noUit: 'Hiányzó UIT', expDocs: 'Lejáró dokumentum', missWb: 'Hiányzó menetlevél', dueInv: 'Lejáró számla',
    todayList: 'Ma esedékes', attention: 'Figyelmet igényel', nothing: 'Minden rendben — nincs sürgős teendő. 👌',
    debtTitle: 'Kintlévőség ügyfelenként', debtOrders: 'Fizetetlen fuvarok', debtMore: (n) => '… és még ' + n + ' fuvar', thisYear: 'idén', debtNone: 'Nincs fizetetlen lezárt fuvar. 👌', noFinance: 'Ehhez nincs pénzügyi jogosultságod.',
    client: 'Ügyfél', orders: 'Fuvar', unpaid: 'Fizetetlen', overdue: 'Lejárt', oldest: 'Legrégebbi lezárás',
    clientTitle: 'Ügyfél-helyzet', clientActive: 'Aktív fuvar', clientDone90: 'Lezárt (90 nap)', clientRevenue: 'Bevétel (90 nap)',
    expTitle: 'Lejáró dokumentumok', expNone: 'Nincs lejáró dokumentum a figyelési ablakon belül. 👌', doc: 'Dokumentum', who: 'Kire vonatkozik', expires: 'Lejár', daysLeft: 'Nap',
    srvTitle: 'Esedékes szervizek', srvNone: 'Nincs esedékes szerviz. 👌', kmLeft: 'Km hátra', lastSrv: 'Utolsó szerviz',
    ambClient: 'Több ügyfél is illik a névre — melyikre gondolsz?',
    // ajánlat
    quoteTitle: 'Árajánlat-becslés', quoteAsk: 'Honnan hova? Írd így: „Mennyibe kerülne Kolozsvárról Budapestre?" vagy „ajánlat Cluj → Budapest".',
    routeErr: 'Az útvonalat nem sikerült kiszámolni — ellenőrizd a helységneveket.',
    distance: 'Távolság', duration: 'Menetidő', toll: 'Útdíj (becslés)', fuel: 'Üzemanyag (becslés)', cost: 'Önköltség (becslés)',
    suggested: 'Javasolt ár', margin: 'Becsült árrés', basis: (n, r) => 'Alap: a cég ' + n + ' korábbi lezárt fuvarjának medián ára (' + r + ' EUR/km).',
    basisDefault: (r) => 'Kevés korábbi adat — alapértelmezett ' + r + ' EUR/km.', weightNote: 'Részrakomány — az ár arányosítható.',
    saveQuote: '💾 Árajánlat mentése', toOrder: '➡️ Fuvar kiírása ebből', clientName: 'Ügyfél neve', quoteSaved: (id) => '✅ Árajánlat elmentve (#' + id + ') — az Árajánlatok oldalon látod.',
    needClient: 'Add meg az ügyfél nevét az árajánlathoz.', h: 'ó',
    // üzenet
    msgTitle: 'Üzenet a sofőrnek', msgOpen: '💬 Megnyitás WhatsAppban', noPhone: (n) => n + ' telefonszáma nincs megadva a felhasználói adatlapon.',
    msgEmpty: 'Mit írjak neki? Pl.: „Írd meg Petőnek, hogy a lerakó 14:00-ra módosult."',
    // tömeges + dokumentum-nyomkövetés
    bulk: 'Tömeges módosítás', bulkScope: 'Fuvarok', bulkPeriod: 'Időszak', bulkCount: (n) => n + ' fuvar',
    bulkNone: 'Ebben az időszakban nincs a feltételnek megfelelő fuvar.', bulkMore: (n) => '… és még ' + n + ' fuvar',
    bulkTooMany: (n) => 'Túl sok fuvar (' + n + ') — egyszerre legfeljebb 500. Szűkítsd ügyfélre vagy hónapra.',
    bulkNotFinal: (n) => n + ' fuvar még nincs lezárva — a fizetés a Pénzügyben csak a lezártaknál rendeződik.',
    bulkDone: (r) => '✅ Kész — ' + r.count + ' fuvar módosítva' + (r.finalized ? ', ' + r.finalized + ' lezárva' : '') + (r.finance_synced ? ', ' + r.finance_synced + ' a Pénzügyben is rendezve' : '') + '.',
    bulkWhat: 'Mit állítsak be ezekre a fuvarokra? Pl. „jelöld fizetettnek", „postáztuk", „zárd le", „számlaszám FCT-123".',
    pd: 'Dokumentum-nyomkövetés', fFinal: 'Lezárás', fInv: 'Számlaszám', fSent: 'Posta elküldve', fRecv: 'Posta átvéve', fPaid: 'Kifizetve', fNote: 'Megjegyzés',
    yes: 'igen', anyClient: 'minden ügyfél', onlyFinal: 'csak lezártak',
    docTitle: 'Dokumentum feltöltése fuvarhoz', docUp: '📎 Feltöltés ehhez', docPick: 'Melyik fuvarhoz? Válaszd ki:',
    docLatest: 'A legutóbb lezárt fuvar', docNone: 'Nem találtam ilyen fuvart. Írd be a fuvarszámot, vagy nyisd meg a feltöltő ablakot és keress ott.',
    docOpenAny: '📎 Feltöltő ablak megnyitása',
    viewTitle: 'Fuvar', viewDocs: 'Dokumentumok', viewNoDocs: 'Ehhez a fuvarhoz még nincs feltöltött dokumentum.', viewDetails: '🔎 Teljes adatlap',
    vStatus: 'Státusz', vLoad: 'Felrakás', vUnload: 'Lerakás', vDriver: 'Sofőr / jármű', vPrice: 'Fuvardíj', vType: 'Típus', vFile: 'Fájl', vDate: 'Dátum',
    dt: { invoice: 'Számla', cmr: 'CMR', pod: 'POD / fotó', order: 'Megbízás', contract: 'Szerződés', customs: 'Vám', receipt: 'Nyugta', other: 'Egyéb' }, docHint: 'A feltöltésnél a számlaszámot és a dátumot a rendszer AI nélkül kiolvassa, és jelzi, ha a számla nem a fuvar megrendelőjére szól.',
    months: ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'],
  },
  ro: {
    confirm: '✅ Confirmă', cancel: '✕ Renunță', confirmQ: 'Voi executa următoarea modificare — confirmi?',
    assign: 'Alocare', status: 'Schimbare status', pay: 'Înregistrare plată', date: 'Modificare dată', price: 'Modificare preț',
    driver: 'Șofer', vehicle: 'Vehicul', none: '—', from: 'Acum', to: 'Nou', amount: 'Sumă',
    loadDate: 'Data încărcării', unloadDate: 'Data descărcării', orderPrice: 'Preț cursă',
    noOrder: 'La ce cursă te referi? Scrie numărul cursei (ex. CMD-2026-0042).',
    orderNotFound: (r) => 'Nu găsesc cursa ' + r + '.',
    whoAssign: 'Cui / cărui vehicul o aloc? Scrie numele șoferului sau numărul de înmatriculare.',
    notFinal: 'Plata se poate înregistra doar pentru o cursă Finalizată.',
    alreadyPaid: 'Această cursă este deja plătită integral.',
    sameStatus: 'Cursa are deja acest status.',
    st: { Finalizat: 'Finalizat', 'In Curs': 'În curs', Disponibil: 'Disponibil', Alocat: 'Alocat', Extern: 'Extern', Parkolt: 'Predat (pe remorcă)', Raktarban: 'În depozit', Anulat: 'Anulat' },
    done: '✅ Gata.', expired: 'Confirmarea a expirat — cere din nou.', badToken: 'Operațiune invalidă.',
    suggestTitle: 'Propunere de alocare', suggestNone: 'Nu există camion liber în apropiere — radarul nu a găsit propuneri.',
    freeDrivers: 'Șoferi liberi (fără cursă activă)', assignThis: '➕ Alocă acestuia', km: 'km', overlap: '⚠️ suprapunere',
    live: '📍 GPS live', freeFrom: 'liber', alreadyAssigned: (p) => 'Cursa este deja alocată (' + p + ').',
    briefTitle: 'Rezumatul zilei', active: 'Curse active', todayLoad: 'Încărcări azi', todayUnload: 'Descărcări azi', late: 'Întârziate',
    waiting: 'De alocat', noUit: 'UIT lipsă', expDocs: 'Documente care expiră', missWb: 'Foi de parcurs lipsă', dueInv: 'Facturi scadente',
    todayList: 'Programat azi', attention: 'Necesită atenție', nothing: 'Totul în regulă — nimic urgent. 👌',
    debtTitle: 'Restanțe pe clienți', debtOrders: 'Curse neplătite', debtMore: (n) => '… și încă ' + n + ' curse', thisYear: 'anul acesta', debtNone: 'Nu există curse finalizate neplătite. 👌', noFinance: 'Nu ai drept de acces la datele financiare.',
    client: 'Client', orders: 'Curse', unpaid: 'Neplătit', overdue: 'Scadent', oldest: 'Cea mai veche finalizare',
    clientTitle: 'Situația clientului', clientActive: 'Curse active', clientDone90: 'Finalizate (90 zile)', clientRevenue: 'Venit (90 zile)',
    expTitle: 'Documente care expiră', expNone: 'Niciun document nu expiră în fereastra de alertă. 👌', doc: 'Document', who: 'Pentru', expires: 'Expiră', daysLeft: 'Zile',
    srvTitle: 'Revizii scadente', srvNone: 'Nicio revizie scadentă. 👌', kmLeft: 'Km rămași', lastSrv: 'Ultima revizie',
    ambClient: 'Mai mulți clienți se potrivesc — la care te referi?',
    quoteTitle: 'Estimare ofertă', quoteAsk: 'De unde până unde? Scrie: „Cât ar costa de la Cluj la Budapesta?" sau „ofertă Cluj → Budapesta".',
    routeErr: 'Ruta nu a putut fi calculată — verifică localitățile.',
    distance: 'Distanță', duration: 'Durată', toll: 'Taxe drum (estimare)', fuel: 'Combustibil (estimare)', cost: 'Cost propriu (estimare)',
    suggested: 'Preț recomandat', margin: 'Marjă estimată', basis: (n, r) => 'Bază: prețul median din ' + n + ' curse finalizate ale firmei (' + r + ' EUR/km).',
    basisDefault: (r) => 'Date istorice insuficiente — implicit ' + r + ' EUR/km.', weightNote: 'Încărcătură parțială — prețul poate fi proporționat.',
    saveQuote: '💾 Salvează oferta', toOrder: '➡️ Creează cursa din asta', clientName: 'Nume client', quoteSaved: (id) => '✅ Oferta a fost salvată (#' + id + ') — o găsești la Oferte.',
    needClient: 'Introdu numele clientului pentru ofertă.', h: 'h',
    msgTitle: 'Mesaj către șofer', msgOpen: '💬 Deschide în WhatsApp', noPhone: (n) => n + ' nu are număr de telefon în fișa utilizatorului.',
    msgEmpty: 'Ce să-i scriu? Ex.: „Scrie-i lui Ion că descărcarea s-a mutat la 14:00."',
    bulk: 'Modificare în masă', bulkScope: 'Curse', bulkPeriod: 'Perioadă', bulkCount: (n) => n + ' curse',
    bulkNone: 'Nu există curse care să corespundă în această perioadă.', bulkMore: (n) => '… și încă ' + n + ' curse',
    bulkTooMany: (n) => 'Prea multe curse (' + n + ') — maximum 500 odată. Restrânge pe client sau lună.',
    bulkNotFinal: (n) => n + ' curse nu sunt încă finalizate — plata se reglează în Financiar doar la cele finalizate.',
    bulkDone: (r) => '✅ Gata — ' + r.count + ' curse modificate' + (r.finalized ? ', ' + r.finalized + ' finalizate' : '') + (r.finance_synced ? ', ' + r.finance_synced + ' reglate și în Financiar' : '') + '.',
    bulkWhat: 'Ce să setez pe aceste curse? Ex. „marchează plătite", „trimise prin poștă", „finalizează", „factura FCT-123".',
    pd: 'Urmărire documente', fFinal: 'Finalizare', fInv: 'Nr. factură', fSent: 'Trimis prin poștă', fRecv: 'Poștă recepționată', fPaid: 'Încasat', fNote: 'Observații',
    yes: 'da', anyClient: 'toți clienții', onlyFinal: 'doar finalizate',
    docTitle: 'Încărcare document la cursă', docUp: '📎 Încarcă aici', docPick: 'La ce cursă? Alege:',
    docLatest: 'Ultima cursă finalizată', docNone: 'Nu am găsit o astfel de cursă. Scrie numărul cursei sau deschide fereastra de încărcare și caută acolo.',
    docOpenAny: '📎 Deschide fereastra de încărcare',
    viewTitle: 'Cursă', viewDocs: 'Documente', viewNoDocs: 'Nu există încă documente încărcate la această cursă.', viewDetails: '🔎 Fișa completă',
    vStatus: 'Status', vLoad: 'Încărcare', vUnload: 'Descărcare', vDriver: 'Șofer / vehicul', vPrice: 'Preț cursă', vType: 'Tip', vFile: 'Fișier', vDate: 'Dată',
    dt: { invoice: 'Factură', cmr: 'CMR', pod: 'POD / foto', order: 'Comandă', contract: 'Contract', customs: 'Vamă', receipt: 'Bon', other: 'Altele' }, docHint: 'La încărcare, numărul și data facturii sunt citite fără AI, iar sistemul semnalează dacă factura nu e pe clientul cursei.',
    months: ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'],
  },
};
const t_ = (lang) => T[lang === 'hu' ? 'hu' : 'ro'];

// ─── Aláírt művelet-token ───
const SECRET = process.env.SESSION_SECRET || process.env.INTEGRATION_ENC_KEY || 'vs-chat-actions';
const TOKEN_TTL_MS = 15 * 60 * 1000;
function signAction(p) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verifyAction(tok) {
  const s = String(tok || '');
  const i = s.indexOf('.');
  if (i < 1 || s.length > 4000) return null;
  const body = s.slice(0, i); const mac = s.slice(i + 1);
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
}

// Belső handler-hívás ugyanazzal a req-gel (szerep + cég-ellenőrzés a handlerben).
function callH(fn, req, args) {
  return new Promise((resolve) => {
    Promise.resolve(fn(req, { json: (p) => resolve((p && p.result) || p) }, args))
      .catch((e) => { console.error('chatOps belső hívás hiba:', e && e.message); resolve({ ok: false, err: 'Eroare de server' }); });
  });
}
const q = H.q;
const safeId = (id) => (/^[A-Za-z0-9_-]{1,60}$/.test(String(id || '')) ? String(id) : null);

// ─── Fuvar-hivatkozás: a mostani szövegből, különben az előzményből ───
const REF_RE = /\b((?:[A-Z]{1,10}-)?\d{4}-\d{1,6}|CMD-[A-Z0-9]{8,14})\b/i;
const HASH_RE = /#\s?(\d{1,6})\b/;
// Csupasz sorszám („a 0042-t", „cursa 42", „#42") — csak névelő/fuvar-szó után
// vagy HU raggal, hogy egy ár / súly / km ne legyen fuvarszám.
const BARE_RE = /(?:^|[\s(])(?:a|az|cursa|cursei|comanda|fuvar\w*|nr\.?)\s+(\d{2,6})(?![\d.,:]|\s*(?:eur|euro|€|ron|lei|lej|km|kg|t\b|to\b|tonn))|\b(\d{2,6})-(?:t|at|et|ot|öt|es|as|os|ét|át|ra|re|nak|nek|ról|ről|hoz|höz|ból|ből)\b/i;
function refIn(text) {
  const s = String(text || '');
  const m = REF_RE.exec(s);
  if (m) return m[1];
  const h = HASH_RE.exec(s);
  if (h) return h[1];
  const b = BARE_RE.exec(s);
  return b ? (b[1] || b[2]) : null;
}
function stripRef(text) {
  return String(text || '').replace(REF_RE, ' ').replace(HASH_RE, ' ').replace(BARE_RE, ' ');
}
async function findOrder(cid, text, history) {
  let ref = refIn(text);
  let fromHistory = false;
  if (!ref) {
    for (const h of (history || []).slice(0, 6)) { ref = refIn(h); if (ref) { fromHistory = true; break; } }
  }
  if (!ref) return { ref: null };
  const md = require('./mailData');
  const r = await md.resolveOrderRefs(cid, [ref]);
  if (r.found.length) {
    const o = r.found[0];
    const full = await q(`SELECT o.id, o.status, o.pret, o.paid_amount, o.email_sofer, o.nume_sofer, o.rendszam_camion,
                                 o.data_incarcare, o.data_descarcare, o.loc_incarcare, o.loc_descarcare, o.client,
                                 COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no
                            FROM orders o WHERE o.id = $1 AND o.company_id = $2`, [o.id, cid]);
    return { ref, order: full[0] || null, fromHistory };
  }
  return { ref, order: null, ambiguous: r.ambiguous[0] || null, fromHistory };
}

// ─── Dátum a szövegből (ma / holnap / holnapután / ISO / nap.hó(.év)) ───
function dateIn(f, now) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (n) => { const d = new Date(d0); d.setDate(d.getDate() + n); return iso(d); };
  if (/\b(holnaputan\w*|poimaine|poimane)\b/.test(f)) return add(2);
  if (/\b(holnap\w*|maine|mane|tomorrow)\b/.test(f)) return add(1);
  if (/\b(ma|mara|azi|astazi|today)\b/.test(f)) return add(0);
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(f);
  if (m) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  m = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/.exec(f);
  if (m) {
    let y = m[3] ? +m[3] : d0.getFullYear(); if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    if (!isNaN(d) && d.getDate() === +m[1]) return iso(d);
  }
  return null;
}

// ─── Kártya-építők ───
function actionCard(t, title, rows, token) {
  return '<div class="och-info"><div class="och-info-s och-act"><div class="och-info-st">⚡ ' + esc(title) + '</div>'
    + '<div class="och-info-mut">' + esc(t.confirmQ) + '</div>'
    + '<table class="och-info-t"><tbody>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + (r[1] && r[1].__html != null ? r[1].__html : esc(r[1])) + '</td></tr>').join('') + '</tbody></table>'
    + '<div class="och-info-btns"><button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(token) + '" onclick="OrderChat.act(this)">' + esc(t.confirm) + '</button>'
    + '<button type="button" class="och-info-btn" data-tok="' + esc(token) + '" onclick="OrderChat.actCancel(this)">' + esc(t.cancel) + '</button></div></div></div>';
}
const change = (a, b) => ({ __html: '<s class="och-act-old">' + esc(a || '—') + '</s> → <b>' + esc(b || '—') + '</b>' });
const orderLabel = (o) => '#' + (o.fuvar_no || o.id) + ' · ' + [cityOf(o.loc_incarcare), cityOf(o.loc_descarcare)].filter(Boolean).join(' → ');
const mkTok = (ctx, p) => signAction(Object.assign({ cid: ctx.cid, uid: ctx.uid, exp: Date.now() + TOKEN_TTL_MS }, p));

// ═════════════════ 1) MŰVELETEK ═════════════════
const ACT = {
  pay: /\b(fizetett\w*|kifizet\w*|fizetve|befizet\w*|platit\w*|achitat\w*|incasat\w*)\b/,
  payVerb: /\b(jelold|jeloljuk|rogzits|rogzitsd|tedd|allitsd|marcheaza|marcheaz\w*|inregistreaz\w*|seteaz\w*|pune)\b/,
  statusVerb: /\b(allitsd|allits|tedd|jelold|zard le|zarjuk le|lezar\w*|finalizeaz\w*|inchide\w*|marcheaz\w*|seteaz\w*|pune|mut\w*)\b/,
  stFinal: /\b(lezart\w*|lezar\w*|zard le|kesz\w*|finalizat\w*|finalizeaz\w*|teljesit\w*|inchis\w*|inchide\w*|completed|done)\b/,
  stRoad: /\b(uton|folyamatban|in curs|elindult|pornit|on the road)\b/,
  stFree: /\b(disponibil\w*|kiosztatlan\w*|vissza a listara)\b/,
  dateField: /\b(felrakas\w*|felrako\w*|rakodas\w*|incarcare\w*|incarca\w*|lerakas\w*|lerako\w*|descarcare\w*|descarca\w*)\b/,
  dateVerb: /\b(csuszik|csusztatjuk|modosul|modosit\w*|legyen|lesz|halaszt\w*|tolod\w*|toljuk|atrak\w*|athely\w*|schimba\w*|amana\w*|muta\w*|devine|este)\b/,
  price: /\b(ar|ara|arat|aru|fuvardij\w*|dij|pret\w*|tarif\w*)\b/,
  priceVerb: /\b(legyen|lesz|allitsd|modosit\w*|emeld|csokkentsd|schimba\w*|seteaz\w*|pune|devine|fie)\b/,
  assign: /\b(rendeld|rendelj|oszd ki|oszd|osszuk|add oda|add at|adjuk|vigye|vigye el|tedd ra|tegyuk ra|rakd ra|asigneaz\w*|aloca\w*|atribui\w*|da-i|da i|pune pe|pe camionul|lui)\b/,
};

async function detectAction(ctx, text, history, now, focusHist) {
  const t = ctx.t;
  const f = fold(text);
  const isPay = ACT.pay.test(f) && !NEG_PAY_RE.test(f) && (ACT.payVerb.test(f) || refIn(text) || !!focusHist);
  const stKey = ACT.statusVerb.test(f) ? (ACT.stFinal.test(f) ? 'Finalizat' : ACT.stRoad.test(f) ? 'In Curs' : ACT.stFree.test(f) ? 'Disponibil' : null) : null;
  const dField = ACT.dateField.test(f) ? (/\b(lerakas\w*|lerako\w*|descarcare\w*|descarca\w*)\b/.test(f) ? 'data_descarcare' : 'data_incarcare') : null;
  const dVal = dField && (ACT.dateVerb.test(f) || refIn(text)) ? dateIn(f, now) : null;
  let priceM = null;
  if (ACT.price.test(f) && ACT.priceVerb.test(f)) {
    const pf = fold(stripRef(text)).replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
    const all = []; const re = /(\d[\d .]*\d|\d)(?:[.,](\d{1,2}))?\s*(eur|euro|€)?/g; let mm;
    while ((mm = re.exec(pf))) all.push({ v: mm[1].replace(/[ .]/g, '') + (mm[2] ? '.' + mm[2] : ''), cur: !!mm[3] });
    const pick = all.find((x) => x.cur) || all[all.length - 1];
    if (pick) priceM = [null, pick.v];
  }
  const pdo = cleanOps(pdOps(text, now, false));
  delete pdo.finalize; delete pdo.payment_status_ext; delete pdo.payment_received_at; delete pdo.sync_finance;
  const isPd = Object.keys(pdo).length > 0 && !isPay && !dVal && !priceM;
  const isAssign = ACT.assign.test(f) && !isPay && !stKey && !dVal && !priceM && !isPd;
  if (!isPay && !stKey && !dVal && !priceM && !isAssign && !isPd) return null;

  // Művelethez fuvar kell — a mostani szövegben VAGY (kiosztásnál nem) az előzményben.
  const fo = await findOrder(ctx.cid, text, (isAssign && !refIn(text)) ? [] : history);
  if (isAssign && !fo.ref) return null; // „vigye" fuvarszám nélkül → valószínűleg fuvar-leírás
  if (!fo.ref) return { reply: t.noOrder, html: '', questions: [] };
  if (fo.ambiguous) return { reply: t.noOrder, html: '', questions: [{ text: t.noOrder, options: fo.ambiguous.options.slice(0, 5).map((n) => text.replace(REF_RE, n).replace(HASH_RE, n)) }] };
  if (!fo.order) return { reply: t.orderNotFound(fo.ref), html: '', questions: [] };
  const o = fo.order;
  const lbl = orderLabel(o);

  if (isPay) {
    if (o.status !== 'Finalizat') return { reply: t.notFinal, html: '', questions: [] };
    const remaining = Math.round((num(o.pret) - num(o.paid_amount)) * 100) / 100;
    const am = /(\d[\d .]*(?:[.,]\d+)?)\s*(eur|euro|€)/.exec(fold(stripRef(text)));
    const amount = am ? num(am[1].replace(/[ ]/g, '')) : remaining;
    if (!(amount > 0)) return { reply: t.alreadyPaid, html: '', questions: [] };
    const tok = mkTok(ctx, { t: 'pay', oid: o.id, amount });
    return { reply: '⚡ ' + t.pay + ' — ' + lbl, html: actionCard(t, t.pay, [[t.orders || 'Fuvar', lbl], [t.amount, fmtN(amount, 2) + ' EUR'], [t.orderPrice, fmtN(num(o.pret), 2) + ' EUR']], tok), questions: [], action: 'pay' };
  }
  if (isPd && !stKey) {
    const tok = mkTok(ctx, { t: 'pd', oid: o.id, ops: pdo });
    return { reply: '⚡ ' + t.pd + ' — ' + lbl, html: actionCard(t, t.pd, [['#', lbl]].concat(opRows(t, pdo)), tok), questions: [], action: 'pd' };
  }
  if (stKey) {
    if (o.status === stKey) return { reply: t.sameStatus, html: '', questions: [] };
    const tok = mkTok(ctx, { t: 'status', oid: o.id, status: stKey });
    return { reply: '⚡ ' + t.status + ' — ' + lbl, html: actionCard(t, t.status, [['#', lbl], [t.status, change(t.st[o.status] || o.status, t.st[stKey])]], tok), questions: [], action: 'status' };
  }
  if (dVal) {
    const cur = o[dField] ? fmtD(o[dField] instanceof Date ? iso(o[dField]) : o[dField]) : '—';
    const tok = mkTok(ctx, { t: 'date', oid: o.id, field: dField, date: dVal });
    return { reply: '⚡ ' + t.date + ' — ' + lbl, html: actionCard(t, t.date, [['#', lbl], [dField === 'data_incarcare' ? t.loadDate : t.unloadDate, change(cur, fmtD(dVal))]], tok), questions: [], action: 'date' };
  }
  if (priceM) {
    const pret = num(String(priceM[1]).replace(/[ ]/g, ''));
    if (!(pret > 0) || pret > 1e7) return null;
    const tok = mkTok(ctx, { t: 'price', oid: o.id, pret });
    return { reply: '⚡ ' + t.price + ' — ' + lbl, html: actionCard(t, t.price, [['#', lbl], [t.orderPrice, change(fmtN(num(o.pret), 2) + ' EUR', fmtN(pret, 2) + ' EUR')]], tok), questions: [], action: 'price' };
  }
  // Kiosztás: sofőr vagy rendszám a fuvarszámon kívüli szövegből.
  const rest = stripRef(text);
  const ent = await findEntity(ctx.cid, rest, {});
  if (!ent) return { reply: t.whoAssign, html: '', questions: [] };
  if (ent.ambiguous) return { reply: t.whoAssign, html: '', questions: [{ text: t.whoAssign, options: ent.ambiguous.map((n) => 'Rendeld ' + (o.fuvar_no || o.id) + ' → ' + n) }] };
  if (ent.plate) {
    const tok = mkTok(ctx, { t: 'assign_plate', oid: o.id, plate: ent.plate_label || ent.plate });
    return { reply: '⚡ ' + t.assign + ' — ' + lbl, html: actionCard(t, t.assign, [['#', lbl], [t.vehicle, change(o.rendszam_camion, ent.plate_label || ent.plate)]], tok), questions: [], action: 'assign' };
  }
  let plate = o.rendszam_camion || null;
  if (!plate) { const r = await q(`SELECT rendszam FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = $2 ORDER BY id LIMIT 1`, [ctx.cid, ent.email]); plate = r[0] ? r[0].rendszam : null; }
  const tok = mkTok(ctx, { t: 'assign_driver', oid: o.id, email: ent.email, name: ent.name, plate: o.rendszam_camion ? null : plate });
  const rows = [['#', lbl], [t.driver, change(o.nume_sofer, ent.name)]];
  if (!o.rendszam_camion && plate) rows.push([t.vehicle, change(null, plate)]);
  return { reply: '⚡ ' + t.assign + ' — ' + lbl, html: actionCard(t, t.assign, rows, tok), questions: [], action: 'assign' };
}

// Végrehajtás (a kliens ✅ gombja után).
async function executeAction(req, token, extra, lang) {
  const t = t_(lang);
  const p = verifyAction(token);
  const u = req.session && req.session.user;
  if (!p || !u || p.cid !== u.company_id || p.uid !== u.id) return { ok: false, err: t.badToken };
  if (!(p.exp > Date.now())) return { ok: false, err: t.expired };
  const oid = p.oid ? safeId(p.oid) : null;
  let r;
  if (p.t === 'bulk') {
    const isRange = !!p.range;
    if (isRange ? !validRange(p.range) : (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to))) return { ok: false, err: t.badToken };
    const ops = cleanOps(p.ops);
    if (!Object.keys(ops).length) return { ok: false, err: t.badToken };
    const sc = { from: p.from, to: p.to, range: isRange ? p.range : null, client_id: Number.isInteger(p.client_id) ? p.client_id : null, only_final: p.only_final === true };
    const rows = await bulkOrders(u.company_id, sc);
    if (!rows.length) return { ok: false, err: t.bulkNone };
    if (rows.length > 500) return { ok: false, err: t.bulkTooMany(rows.length) };
    const pd = require('../handlers/orderPostDelivery');
    r = await callH(pd.setOrderPostDeliveryBulk, req, [Object.assign({ order_ids: rows.map((o) => o.id) }, ops)]);
    if (!r || !r.ok) return { ok: false, err: (r && r.err) || 'Eroare de server' };
    try { await require('./audit').fromReq(req, 'order.chat_action', 'order', null, { type: 'bulk', count: r.count, ops: Object.keys(ops) }); } catch (_) {}
    return { ok: true, reply: t.bulkDone(r), type: 'bulk', count: r.count };
  }
  if (p.t === 'pd') {
    const ops = cleanOps(p.ops);
    delete ops.finalize; delete ops.sync_finance;
    if (!Object.keys(ops).length) return { ok: false, err: t.badToken };
    const pd = require('../handlers/orderPostDelivery');
    r = await callH(pd.setOrderPostDelivery, req, [Object.assign({ order_id: oid }, ops)]);
  } else if (p.t === 'pay') {
    const sh = require('../handlers/statisticsHandlers');
    r = await callH(sh.markOrderPayment, req, [oid, { amount: p.amount, method: 'chat' }]);
    // A dokumentum-nyomkövetés „Kifizetve" jelzése is igazodjon (best-effort).
    if (r && r.ok) {
      const cur = await q(`SELECT COALESCE(pret,0) AS pret, COALESCE(paid_amount,0) AS paid FROM orders WHERE id = $1 AND company_id = $2`, [oid, u.company_id]);
      if (cur[0] && num(cur[0].paid) >= num(cur[0].pret)) {
        try { const pd = require('../handlers/orderPostDelivery'); await callH(pd.setOrderPostDelivery, req, [{ order_id: oid, payment_status_ext: 'paid', payment_received_at: iso(new Date()) }]); } catch (_) {}
      }
    }
  } else if (p.t === 'status') {
    const oh = require('../handlers/orders');
    r = await callH(oh.comUpdate, req, [oid, { status: p.status }]);
  } else if (p.t === 'date') {
    if (!['data_incarcare', 'data_descarcare'].includes(p.field) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return { ok: false, err: t.badToken };
    const oh = require('../handlers/orders');
    r = await callH(oh.comUpdate, req, [oid, { [p.field]: p.date }]);
  } else if (p.t === 'price') {
    const oh = require('../handlers/orders');
    r = await callH(oh.comUpdate, req, [oid, { pret: p.pret }]);
  } else if (p.t === 'assign_plate') {
    const oh = require('../handlers/orders');
    r = await callH(oh.plannerAssign, req, [oid, { rendszam_camion: p.plate }]);
  } else if (p.t === 'assign_driver') {
    // A sofőr a cég saját sofőrje-e (a token aláírt, de a cég-tagságot most is ellenőrizzük).
    const d = await q(`SELECT LOWER(email) AS email, nume FROM users WHERE company_id = $1 AND LOWER(email) = $2 AND pozicio = 'Sofer'`, [u.company_id, String(p.email || '').toLowerCase()]);
    if (!d.length) return { ok: false, err: t.badToken };
    const oh = require('../handlers/orders');
    const upd = { sofer_type: 'Intern', email_sofer: d[0].email, nume_sofer: d[0].nume };
    if (p.plate) upd.rendszam_camion = p.plate;
    // A comUpdate a Disponibil → Alocat léptetést a státusszal együtt végzi.
    const cur = await q(`SELECT status FROM orders WHERE id = $1 AND company_id = $2`, [oid, u.company_id]);
    if (cur[0] && cur[0].status === 'Disponibil') upd.status = 'Disponibil';
    r = await callH(oh.comUpdate, req, [oid, upd]);
  } else if (p.t === 'quote') {
    const clientName = String((extra && extra.client_name) || p.client || '').trim().slice(0, 200);
    if (!clientName) return { ok: false, err: t.needClient };
    const qh = require('../handlers/quotes');
    r = await callH(qh.quoteSave, req, [{ client_name: clientName, loc_from: p.from, loc_to: p.to, price: p.price, valuta: 'EUR', note: p.note || null }]);
    if (r && r.ok) return { ok: true, reply: t.quoteSaved(r.id), type: p.t };
  } else {
    return { ok: false, err: t.badToken };
  }
  if (!r || !r.ok) return { ok: false, err: (r && r.err) || 'Eroare de server' };
  try { await require('./audit').fromReq(req, 'order.chat_action', 'order', oid, { type: p.t }); } catch (_) {}
  return { ok: true, reply: t.done, type: p.t, order_id: oid };
}

// ═════════════════ 1b) DOKUMENTUM-NYOMKÖVETÉS + TÖMEGES MŰVELET ═════════════════
// A Fuvarkezelés „✏️ Tömeges szerkesztés" (setOrderPostDeliveryBulk) chatből:
// „A szeptemberi összes fuvart jelöld fizetettnek", „a Bilka októberi fuvarjait
// postáztuk", „zárd le a múlt havi fuvarokat". Egy fuvarra is: „a 0042-t
// postáztuk", „a 0042 számlaszáma FCT-123".
const PD = {
  sent: /\b(postaz\w*|postan\w*|postara|feladtuk|elkuldtuk|elpostaz\w*|trimis\w*|expediat\w*|expedia\w*)\b/,
  recvVerb: /\b(megkapt\w*|megerkez\w*|atvett\w*|atvet\w*|kezbesit\w*|visszaj\w*|primit\w*|receptionat\w*|receptiona\w*|ajuns\w*|sosit\w*)\b/,
  mail: /\b(posta\w*|dokumentum\w*|papir\w*|cmr\w*|acte\w*|actele|document\w*|originale?\w*)\b/,
  finalVerb: /\b(zard le|zarjuk le|zartuk le|lezartuk|lezarni|zard|finalizeaz\w*|finalizam|finalizati|inchide\w*|inchidem)\b/,
  finalAdj: /\b(lezart|lezartak|lezartakat|finalizate|finalizat\w*|inchise)\b/,
  group: /\b(osszes\w*|minden|mindet|mindegyik\w*|egesz|toate|toti|tot|all|fuvarok\w*|fuvarjai\w*|cursele|curse)\b/,
};
const INV_RE = /(?:sz[áa]ml\w*|factur\w*|invoice)\s*(?:sz[áa]m\w*|nr\.?|num[ăa]r\w*|no\.?)?\s*[:#]?\s*([A-Za-z]{0,8}[-/]?\d[A-Za-z0-9\-/]{0,30})/i;
const NOTE_RE = /(?:megjegyz[ée]s\w*|not[ăa]|observa[țt]i\w*)\s*:\s*(.{1,500})$/i;

// A szövegből kiolvasott post-delivery műveletek (csak a felismert mezők).
function pdOps(text, now, bulk) {
  const f = fold(text);
  const op = {};
  const day = dateIn(f.replace(/\b\d{4}-\d{1,2}\b(?!-)/g, ' '), now) || iso(now);
  if (ACT.pay.test(f) && !NEG_PAY_RE.test(f)) { op.payment_status_ext = 'paid'; op.payment_received_at = day; op.sync_finance = true; }
  if (PD.recvVerb.test(f) && PD.mail.test(f)) op.postal_received_at = day;
  else if (PD.sent.test(f) && (PD.mail.test(f) || /postaz|postan|postara|elpostaz|prin posta/.test(f))) op.postal_sent_at = day;
  if (PD.finalVerb.test(f) || (!bulk && ACT.statusVerb.test(f) && ACT.stFinal.test(f))) op.finalize = true;
  const inv = INV_RE.exec(stripRef(text).replace(/\b\d{4}-\d{1,2}(?:-\d{1,2})?\b/g, ' '));
  if (inv) op.invoice_no = inv[1].slice(0, 50);
  const nt = NOTE_RE.exec(String(text || ''));
  if (nt) op.post_notes = nt[1].trim();
  return op;
}

// Hónap-hatókör: „szeptemberi", „septembrie", „múlt havi", „luna aceasta", „2026-09".
const MONTH_RE = [/\bjan\w*|\bianuar\w*/, /\bfebr\w*/, /\bmarc\w*|\bmart\w*/, /\bapril\w*/, /\bmajus\w*|\b(?:luna|in|din|pe|lunii) mai\b/,
  /\bjunius\w*|\biuni\w*/, /\bjulius\w*|\biuli\w*/, /\baugus\w*/, /\bszept\w*|\bsept\w*/, /\bokt\w*|\boct\w*/, /\bnov\w*|\bnoiem\w*/, /\bdec\w*/];
function monthScope(f, now) {
  let y = now.getFullYear(); let m = null;
  let x = /\b(20\d{2})[-./](\d{1,2})\b(?![-./]\d)/.exec(f);
  if (x && +x[2] >= 1 && +x[2] <= 12) { y = +x[1]; m = +x[2] - 1; }
  if (m == null && /\b(multhavi|mult havi|mult honap\w*|elozo honap\w*|luna trecuta|lunii trecute|luna anterioara|last month)\b/.test(f)) { m = now.getMonth() - 1; if (m < 0) { m = 11; y--; } }
  if (m == null && /\b(e havi|ehavi|ebben a honapban|aktualis honap\w*|idei honap\w*|luna aceasta|luna curenta|lunii curente|aceasta luna|this month)\b/.test(f)) m = now.getMonth();
  if (m == null) {
    for (let i = 0; i < 12; i++) if (MONTH_RE[i].test(f)) { m = i; break; }
    if (m == null) return null;
    const yy = /\b(20\d{2})\b/.exec(f);
    if (yy) y = +yy[1]; else if (m > now.getMonth()) y--;
  }
  const from = iso(new Date(y, m, 1)); const to = iso(new Date(y, m + 1, 1));
  return { y, m, from, to, ym: from.slice(0, 7) };
}

function opRows(t, op) {
  const rows = [];
  if (op.finalize) rows.push([t.fFinal, t.yes]);
  if (op.invoice_no) rows.push([t.fInv, op.invoice_no]);
  if (op.postal_sent_at) rows.push([t.fSent, fmtD(op.postal_sent_at)]);
  if (op.postal_received_at) rows.push([t.fRecv, fmtD(op.postal_received_at)]);
  if (op.payment_status_ext === 'paid') rows.push([t.fPaid, fmtD(op.payment_received_at)]);
  if (op.post_notes) rows.push([t.fNote, op.post_notes]);
  return rows;
}
// Csak fehérlistás kulcsok mennek a tokenbe / a handlerbe.
const PD_KEYS = ['finalize', 'invoice_no', 'postal_sent_at', 'postal_received_at', 'payment_status_ext', 'payment_received_at', 'post_notes', 'sync_finance'];
function cleanOps(op) {
  const o = {};
  for (const k of PD_KEYS) if (op && op[k] !== undefined && op[k] !== null && op[k] !== '') o[k] = op[k];
  if (o.finalize !== undefined) o.finalize = o.finalize === true;
  if (o.sync_finance !== undefined) o.sync_finance = o.sync_finance === true;
  for (const k of ['postal_sent_at', 'postal_received_at', 'payment_received_at']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) delete o[k];
  if (o.payment_status_ext && o.payment_status_ext !== 'paid') delete o.payment_status_ext;
  if (o.invoice_no) o.invoice_no = String(o.invoice_no).slice(0, 50);
  if (o.post_notes) o.post_notes = String(o.post_notes).slice(0, 500);
  return o;
}

// A hatókör fuvarjai — UGYANAZ a hónap-szabály, mint a Fuvarkezelés 📅 szűrője.
async function bulkOrders(cid, sc) {
  if (sc.range) {
    // Fuvarszám-tartomány: azonos előtag (pl. „CMD-2026-") + számrész a..b között.
    const rp = [cid, sc.range.p, sc.range.a, sc.range.b]; let rw = '';
    if (sc.client_id) { rp.push(sc.client_id); rw += ` AND o.client_id = $${rp.length}`; }
    if (sc.only_final) rw += ` AND o.status = 'Finalizat'`;
    return q(`SELECT o.id, o.status, o.pret, o.loc_incarcare, o.loc_descarcare, x.fno AS fuvar_no
                FROM orders o
                CROSS JOIN LATERAL (SELECT UPPER(COALESCE(to_jsonb(o)->>'fuvar_no', '')) AS fno) x
               WHERE o.company_id = $1 AND o.status <> 'Anulat'
                 AND LEFT(x.fno, LENGTH($2)) = $2
                 AND (CASE WHEN SUBSTRING(x.fno FROM LENGTH($2) + 1) ~ '^[0-9]{1,9}$'
                           THEN SUBSTRING(x.fno FROM LENGTH($2) + 1)::int END) BETWEEN $3::int AND $4::int${rw}
               ORDER BY x.fno
               LIMIT 501`, rp);
  }
  const p = [cid, sc.from, sc.to]; let w = '';
  if (sc.client_id) { p.push(sc.client_id); w += ` AND o.client_id = $${p.length}`; }
  if (sc.only_final) w += ` AND o.status = 'Finalizat'`;
  return q(`SELECT o.id, o.status, o.pret, o.loc_incarcare, o.loc_descarcare, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no
              FROM orders o
             WHERE o.company_id = $1 AND o.status <> 'Anulat'
               AND COALESCE(o.data_descarcare, o.data_incarcare, o.finalized_at::date, o.created_at::date) >= $2::date
               AND COALESCE(o.data_descarcare, o.data_incarcare, o.finalized_at::date, o.created_at::date) <  $3::date${w}
             ORDER BY COALESCE(o.data_descarcare, o.data_incarcare, o.created_at::date), o.id
             LIMIT 501`, p);
}

// „CMD-2026-0001-től a 0047-ig", „cmd-2026-0001 tol a 0047 ig", „CMD-2026-0001 - CMD-2026-0047",
// „de la CMD-2026-0001 până la 0047" → { p: 'CMD-2026-', a: 1, b: 47 }
function refRange(text) {
  const f = fold(text);
  if (!/\b(tol|ig|pana|pina|intre|kozott)\b|\d\s*[-–]\s*(?:[a-z]{1,10}-)?\d/.test(f)) return null;
  const m1 = /\b([a-z]{1,10}-20\d{2}-)(\d{1,6})\b(?!-\d)/.exec(f);
  if (!m1) return null;
  const after = f.slice(m1.index + m1[0].length, m1.index + m1[0].length + 60);
  const m2 = /^\s*[-–]?\s*(?:tol\b)?\s*(?:(?:a|az|pana la|pina la|la|si|es)\s+)?(?:[a-z]{1,10}-)?(?:20\d{2}-)?(\d{1,6})\b/.exec(after);
  if (!m2) return null;
  const a = parseInt(m1[2], 10); const b = parseInt(m2[1], 10);
  const r = { p: m1[1].toUpperCase(), a: Math.min(a, b), b: Math.max(a, b) };
  return validRange(r) && r.b > r.a ? r : null;
}
function pad4(n) { return String(n).padStart(4, '0'); }
function validRange(r) {
  return !!r && typeof r.p === 'string' && /^[A-Z]{1,10}-20\d{2}-$/.test(r.p)
    && Number.isInteger(r.a) && Number.isInteger(r.b) && r.a >= 0 && r.b >= r.a && r.b - r.a <= 1000;
}

async function detectBulk(ctx, text, now) {
  const t = ctx.t;
  const f = fold(text);
  const range = refRange(text);
  if (refIn(text) && !range && !PD.group.test(f)) return null; // egy konkrét fuvar → detectAction
  if (!range && !PD.group.test(f)) return null;
  const sc = range ? { range } : monthScope(f, now);
  if (!sc) return null;
  const op = cleanOps(pdOps(text, now, true));
  if (!Object.keys(op).length) return null; // csak lekérdezés → más ág
  if (PD.finalAdj.test(f) && !op.finalize) sc.only_final = true;
  // Ügyfél-szűrő (opcionális) — a hónapnév/műveleti szavak nélküli szövegből.
  const cl = await findClient(ctx.cid, text);
  if (cl && cl.ambiguous) return { reply: t.ambClient, html: '', questions: [{ text: t.ambClient, options: cl.ambiguous.map((n) => text + ' — ' + n) }] };
  if (cl) { sc.client_id = cl.id; sc.client = cl.denumire; }
  const rows = await bulkOrders(ctx.cid, sc);
  if (!rows.length) return { reply: t.bulkNone, html: '', questions: [] };
  if (rows.length > 500) return { reply: t.bulkTooMany(rows.length), html: '', questions: [] };
  const period = sc.range ? sc.range.p + pad4(sc.range.a) + ' → ' + sc.range.p + pad4(sc.range.b) : t.months[sc.m] + ' ' + sc.y;
  const notFinal = rows.filter((o) => o.status !== 'Finalizat').length;
  const list = rows.slice(0, 8).map((o) => orderLabel(o)).join('\n') + (rows.length > 8 ? '\n' + t.bulkMore(rows.length - 8) : '');
  const info = [[t.bulkPeriod, period + (sc.client ? ' · ' + sc.client : '') + (sc.only_final ? ' · ' + t.onlyFinal : '')], [t.bulkScope, { __html: '<b>' + esc(t.bulkCount(rows.length)) + '</b><div class="och-info-mut" style="white-space:pre-line">' + esc(list) + '</div>' }]]
    .concat(opRows(t, op));
  if (op.payment_status_ext === 'paid' && notFinal && !op.finalize) info.push(['⚠️', t.bulkNotFinal(notFinal)]);
  const tok = mkTok(ctx, { t: 'bulk', from: sc.from, to: sc.to, range: sc.range || null, client_id: sc.client_id || null, only_final: !!sc.only_final, ops: op, n: rows.length });
  return { reply: '⚡ ' + t.bulk + ' — ' + period + ' · ' + t.bulkCount(rows.length), html: actionCard(t, t.bulk + ' · ' + t.bulkCount(rows.length), info, tok), questions: [], action: 'bulk' };
}

// ═════════════════ 3) KIOSZTÁSI JAVASLAT ═════════════════
const SUGGEST_RE = /\bki vihet\w*|\bkit tegy\w*|\bkit rak\w*|\bki vigye\b|\bki menjen\b|\bkivel vigy\w*|\bjavasol\w*|\bkinek adjam\b|\bcine poate\b|\bcine ar putea\b|\bcine sa (duca|ia)\b|\brecomand\w*|\bsugere\w*|\bpe cine sa pun\b/;
async function detectSuggest(ctx, text, history) {
  const t = ctx.t;
  if (!SUGGEST_RE.test(fold(text))) return null;
  const fo = await findOrder(ctx.cid, text, history);
  if (!fo.ref) return { reply: t.noOrder, html: '', questions: [] };
  if (!fo.order) return { reply: t.orderNotFound(fo.ref), html: '', questions: [] };
  const o = fo.order;
  if (o.rendszam_camion) return { reply: t.alreadyAssigned(o.rendszam_camion + (o.nume_sofer ? ' · ' + o.nume_sofer : '')), html: '', questions: [] };
  const lbl = orderLabel(o);
  let body = '';
  let sugg = [];
  try {
    const oh = require('../handlers/orders');
    const r = await callH(oh.getPlannerMatches, ctx.req, []);
    const m = ((r && r.matches) || []).find((x) => x.order_id === o.id);
    sugg = (m && m.suggestions) || [];
  } catch (_) { sugg = []; }
  if (sugg.length) {
    const rows = [];
    for (const s of sugg.slice(0, 3)) {
      const drv = await q(`SELECT u.nume FROM vehicles v JOIN users u ON LOWER(u.email) = LOWER(v.assigned_driver_email) AND u.company_id = v.company_id
                            WHERE v.company_id = $1 AND UPPER(REGEXP_REPLACE(v.rendszam,'[^A-Za-z0-9]','','g')) = $2 LIMIT 1`, [ctx.cid, plateNorm(s.rendszam)]);
      const tok = mkTok(ctx, { t: 'assign_plate', oid: o.id, plate: s.rendszam });
      const tags = [s.live ? t.live : (s.szabad_tol ? t.freeFrom + ' ' + fmtD(s.szabad_tol) : ''), s.atfedes ? t.overlap : '', s.weight_warn ? '⚖️' : '', s.ftl_conflict ? '🚫 FTL' : ''].filter(Boolean).join(' · ');
      rows.push([{ __html: '<b>🚚 ' + esc(s.rendszam) + '</b>' + (drv[0] ? ' · 👤 ' + esc(drv[0].nume) : '') },
        fmtN(s.km) + ' ' + t.km + (s.honnan ? ' (' + cityOf(s.honnan) + ')' : ''), tags,
        { __html: '<button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(tok) + '" onclick="OrderChat.act(this)">' + esc(t.assignThis) + '</button>' }]);
    }
    body = table([t.vehicle, t.km, '', ''], rows, ctx.L);
  } else {
    // Tartalék: szabad sofőrök (nincs aktív fuvarjuk) — kiosztó gombbal.
    const free = await q(`SELECT u.nume, LOWER(u.email) AS email,
                                 (SELECT v.rendszam FROM vehicles v WHERE v.company_id = u.company_id AND LOWER(v.assigned_driver_email) = LOWER(u.email) ORDER BY v.id LIMIT 1) AS rendszam
                            FROM users u
                           WHERE u.company_id = $1 AND u.pozicio = 'Sofer' AND u.blocked IS NOT TRUE
                             AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.company_id = u.company_id AND LOWER(o.email_sofer) = LOWER(u.email) AND o.status IN ('Alocat','In Curs'))
                           ORDER BY u.nume LIMIT 10`, [ctx.cid]);
    if (free.length) {
      body = '<div class="och-info-note">' + esc(t.suggestNone) + '</div><div class="och-info-sub">' + esc(t.freeDrivers) + '</div>'
        + table([t.driver, t.vehicle, ''], free.map((d) => {
          const tok = mkTok(ctx, { t: 'assign_driver', oid: o.id, email: d.email, name: d.nume, plate: d.rendszam || null });
          return ['👤 ' + d.nume, d.rendszam || '—', { __html: '<button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(tok) + '" onclick="OrderChat.act(this)">' + esc(t.assignThis) + '</button>' }];
        }), ctx.L);
    } else body = '<div class="och-info-empty">' + esc(t.suggestNone) + '</div>';
  }
  return { reply: '💡 ' + t.suggestTitle + ' — ' + lbl, html: '<div class="och-info">' + section('💡', t.suggestTitle + ' · ' + lbl, body) + '</div>', questions: [] };
}

// ═════════════════ 2) CÉGSZINTŰ KÉRDÉSEK ═════════════════
const BRIEF_RE = /^\s*(osszefoglalo|osszesito|rezumat|rezumatul)\s*[?!.]*\s*$|\bmai teendo\w*|\bteendo\w*|\bmi a helyzet\b|\b(napi|mai) (osszefoglalo|osszesito|attekintes)\w*|\bmi van ma\b|\bmai nap\w*|\bmai helyzet\b|\bce avem azi\b|\bce e azi\b|\brezumat(ul)? (zilei|zilnic)\b|\bsituatia (de azi|zilei|de astazi)\b|\bbriefing\b|\bwhat.?s up today\b/;
const DEBT_RE = /\bki tartozik\b|\btartoz\w*|\bkintlevo\w*|\bnem fizet\w*|\bfizetetlen\w*|\bkifizetetl\w*|\bki nem fizet\w*|\bneachitat\w*|\brestant\w*|\bdatoreaz\w*|\bneincasat\w*|\bneplatit\w*|\bcreant\w*|\bcine ne datoreaza\b/;
// Tagadott / kérdő fizetés („kifizetetlen", „nem fizették", „neplătit") — ez LEKÉRDEZÉS, nem fizetés-rögzítés.
const NEG_PAY_RE = /\b(ki)?fizetetl\w*|\bnem (lett |volt |lettek |voltak )?(ki)?fizet\w*|\bki nem fizet\w*|\bneplatit\w*|\bneachitat\w*|\bneincasat\w*|\bnu (s-a |s-au |a fost |au fost )?(platit|achitat|incasat)\w*/;
const LISTQ_RE = /\b(hany|mennyi\w*|mutas\w*|listaz\w*|sorold\w*|melyik\w*|arata\w*|afiseaza|cate|cati)\b/;
const YEAR_RE = /\b(idei|ebben az evben|az idei|iden|anul acesta|in acest an|anul curent|this year)\b/;
const EXP_RE = /\blejar\w*|\bervenyes\w*|\bitp\b|\brca\b|\bcasco\b|\brovinie\w*|\bvigneta\w*|\btahograf\w*|\bexpira\w*|\bvalabil\w*|\basigurar\w*|\bbiztosit\w*|\bmuszaki\w*|\bvizsga\w*/;
const SRV_RE = /\bszerviz\w*|\bservice\b|\brevizi\w*|\bolajcser\w*|\bkarbantart\w*|\bschimb (de )?ulei\b|\bmentenant\w*/;
const QWORD_RE = /^\s*(hol|mikor|mennyi\w*|hany\w*|mit|mi|ki|kik|milyen|melyik\w*|mutas\w*|listaz\w*|sorold\w*|van|vannak|unde|cand|cat|cati|cate|ce|care|cine|arata\w*|afiseaza|spune\w*|exista|show|which|when)\b/;
const CLIENT_STOP = new Set(('srl sa kft zrt bt sc sas gmbh ltd sp z oo trans transport logistic logistics logistik impex com comert spedition spedit expres express group grup international intl europe euro romania hungary company firma cargo freight service services serv').split(' '));

async function _clients(cid) {
  return q(`SELECT id, denumire FROM clients WHERE company_id = $1 AND denumire IS NOT NULL LIMIT 2000`, [cid]);
}
async function findClient(cid, text) {
  const words = fold(text).split(/[ -]/).filter(Boolean);
  let best = []; let bestHit = 0;
  for (const c of await _clients(cid)) {
    const toks = fold(c.denumire).split(/[ -]/).filter((x) => x.length >= 4 && !CLIENT_STOP.has(x));
    const hit = toks.filter((x) => words.some((w) => mi.wordHits(w, x))).length;
    if (!hit) continue;
    if (hit > bestHit) { best = [c]; bestHit = hit; } else if (hit === bestHit) best.push(c);
  }
  if (best.length === 1) return best[0];
  if (best.length > 1) return { ambiguous: best.slice(0, 5).map((c) => c.denumire) };
  return null;
}
async function canSeeFinance(req) {
  const me = req.session.user;
  if (me.pozicio === 'Admin' || me.is_dev) return true;
  if (me.pozicio !== 'Manager') return false;
  const r = await q(`SELECT up.enabled FROM user_permissions up JOIN users u ON u.id = up.user_id
                      WHERE LOWER(u.email) = LOWER($1) AND u.company_id = $2 AND up.perm_key = 'stats_finance'`, [me.email, me.company_id]);
  return !!(r[0] && r[0].enabled);
}

async function renderBrief(ctx) {
  const t = ctx.t;
  const oh = require('../handlers/opsCenter');
  const ops = (await callH(oh.getOpsCenter, ctx.req, [])) || {};
  const c = Object.assign({}, ops.counters || {}, { varakozo: (ops.health && ops.health.waiting) || 0 });
  const g = (k) => (c[k] != null ? c[k] : 0);
  const today = await q(`SELECT o.id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, o.loc_incarcare, o.loc_descarcare, o.nume_sofer, o.rendszam_camion, o.status,
                                (o.data_incarcare = CURRENT_DATE) AS is_load, (o.data_descarcare = CURRENT_DATE) AS is_unload
                           FROM orders o
                          WHERE o.company_id = $1 AND o.status NOT IN ('Anulat','Finalizat')
                            AND (o.data_incarcare = CURRENT_DATE OR o.data_descarcare = CURRENT_DATE)
                          ORDER BY o.data_incarcare NULLS LAST LIMIT 30`, [ctx.cid]);
  let missWb = 0;
  try {
    const dh = require('../handlers/documents');
    const r = await callH(dh.getOrdersMissingWaybill, ctx.req, []);
    missWb = ((r && (r.orders || r.rows || r.list)) || []).length;
  } catch (_) {}
  let ins = [];
  try {
    const sh = require('../handlers/statsInsights');
    const r = await callH(sh.getStatsInsights, ctx.req, []);
    ins = ((r && r.insights) || []).filter((i) => i.severity !== 'info').slice(0, 6);
  } catch (_) {}
  let body = tiles([
    [String(g('aktiv')), t.active], [String(g('mai_felrakas')), t.todayLoad], [String(g('mai_lerakas')), t.todayUnload],
    g('keso') ? [String(g('keso')), '⏰ ' + t.late] : null, g('varakozo') ? [String(g('varakozo')), t.waiting] : null,
    g('hianyzo_uit') ? [String(g('hianyzo_uit')), t.noUit] : null, g('lejaro_dok') ? [String(g('lejaro_dok')), t.expDocs] : null,
    missWb ? [String(missWb), t.missWb] : null, g('lejaro_szamla') ? [String(g('lejaro_szamla')), t.dueInv] : null,
  ]);
  if (today.length) {
    body += '<div class="och-info-sub">📅 ' + esc(t.todayList) + '</div>' + table(['#', t.todayLoad + ' / ' + t.todayUnload, t.driver],
      today.map((o) => [{ __html: '<b>#' + esc(o.fuvar_no) + '</b>' }, (o.is_load ? '⬆️ ' + (cityOf(o.loc_incarcare) || '') : '') + (o.is_load && o.is_unload ? ' · ' : '') + (o.is_unload ? '⬇️ ' + (cityOf(o.loc_descarcare) || '') : ''),
        (o.nume_sofer || '—') + (o.rendszam_camion ? ' · ' + o.rendszam_camion : '')]), ctx.L);
  }
  if (ins.length) {
    body += '<div class="och-info-sub">⚠️ ' + esc(t.attention) + '</div><ul class="och-info-tl">'
      + ins.map((i) => '<li><span class="ic">' + (i.severity === 'danger' ? '🔴' : '🟠') + '</span>' + esc(i.title || '') + (i.detail ? ' — <span class="d">' + esc(i.detail) + '</span>' : '') + '</li>').join('') + '</ul>';
  }
  if (!today.length && !ins.length && !g('keso') && !g('varakozo')) body += '<div class="och-info-empty">' + esc(t.nothing) + '</div>';
  return '<div class="och-info">' + section('☀️', t.briefTitle + ' · ' + fmtD(iso(new Date())), body) + '</div>';
}

// Időszak a kintlévőség-kérdéshez: „idén / ebben az évben" vagy hónap („szeptemberi").
function debtPeriod(f, ctx) {
  const now = new Date();
  if (YEAR_RE.test(f)) return { from: now.getFullYear() + '-01-01', to: (now.getFullYear() + 1) + '-01-01', label: ctx.t.thisYear + ' (' + now.getFullYear() + ')' };
  const ms = monthScope(f, now);
  return ms ? { from: ms.from, to: ms.to, label: ctx.t.months[ms.m] + ' ' + ms.y } : null;
}
async function renderDebts(ctx, client, period) {
  const t = ctx.t;
  if (!(await canSeeFinance(ctx.req))) return '<div class="och-info"><div class="och-info-note">' + esc(t.noFinance) + '</div></div>';
  const p = [ctx.cid]; let w = '';
  if (client) { p.push(client.id); w += ` AND o.client_id = $${p.length}`; }
  if (period && /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to)) {
    p.push(period.from); w += ` AND COALESCE(o.finalized_at::date, o.data_descarcare::date, o.created_at::date) >= $${p.length}::date`;
    p.push(period.to); w += ` AND COALESCE(o.finalized_at::date, o.data_descarcare::date, o.created_at::date) < $${p.length}::date`;
  }
  const rows = await q(`SELECT COALESCE(c.denumire, o.client, '—') AS client, COUNT(*)::int AS db,
                               SUM(GREATEST(COALESCE(o.pret,0) - COALESCE(o.paid_amount,0), 0)) AS unpaid,
                               SUM(CASE WHEN (o.finalized_at::date + (COALESCE(c.payment_term_days,30) || ' days')::interval)::date < CURRENT_DATE
                                        THEN GREATEST(COALESCE(o.pret,0) - COALESCE(o.paid_amount,0), 0) ELSE 0 END) AS overdue,
                               MIN(o.finalized_at) AS oldest
                          FROM orders o LEFT JOIN clients c ON c.id = o.client_id AND c.company_id = o.company_id
                         WHERE o.company_id = $1 AND o.status = 'Finalizat' AND COALESCE(o.payment_status,'unpaid') <> 'paid'
                           AND COALESCE(o.pret,0) > COALESCE(o.paid_amount,0)${w}
                         GROUP BY 1 ORDER BY 3 DESC LIMIT 30`, p);
  if (!rows.length) return '<div class="och-info">' + section('💰', t.debtTitle, '<div class="och-info-empty">' + esc(t.debtNone) + '</div>') + '</div>';
  const sumU = rows.reduce((s, r) => s + num(r.unpaid), 0); const sumO = rows.reduce((s, r) => s + num(r.overdue), 0);
  const cnt = rows.reduce((s, r) => s + r.db, 0);
  // A fizetetlen fuvarok maguk is (fuvarszámmal), legrégebbi elöl.
  const ol = await q(`SELECT COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, COALESCE(c.denumire, o.client, '—') AS client,
                             o.finalized_at, GREATEST(COALESCE(o.pret,0) - COALESCE(o.paid_amount,0), 0) AS unpaid
                        FROM orders o LEFT JOIN clients c ON c.id = o.client_id AND c.company_id = o.company_id
                       WHERE o.company_id = $1 AND o.status = 'Finalizat' AND COALESCE(o.payment_status,'unpaid') <> 'paid'
                         AND COALESCE(o.pret,0) > COALESCE(o.paid_amount,0)${w}
                       ORDER BY o.finalized_at ASC NULLS LAST, o.id LIMIT 31`, p);
  const shown = ol.slice(0, 30);
  return '<div class="och-info">' + section('💰', t.debtTitle, tiles([[fmtN(sumU, 2) + ' EUR', t.unpaid], [fmtN(sumO, 2) + ' EUR', '⏰ ' + t.overdue], [String(cnt), t.orders]])
    + table([t.client, t.orders, t.unpaid, t.overdue, t.oldest], rows.map((r) => [r.client, String(r.db), fmtN(num(r.unpaid), 2), num(r.overdue) ? fmtN(num(r.overdue), 2) : '—', fmtD(r.oldest)]), ctx.L))
    + (shown.length ? section('📋', t.debtOrders, table(['#', t.client, t.oldest, t.unpaid], shown.map((r) => [r.fuvar_no, r.client, fmtD(r.finalized_at), fmtN(num(r.unpaid), 2)]), ctx.L)
      + (cnt > shown.length ? '<div class="och-info-mut">' + esc(t.debtMore(cnt - shown.length)) + '</div>' : '')) : '') + '</div>';
}

async function renderClient(ctx, client) {
  const t = ctx.t;
  const fin = await canSeeFinance(ctx.req);
  const st = await q(`SELECT COUNT(*) FILTER (WHERE o.status IN ('Disponibil','Alocat','In Curs','Extern','Parkolt','Raktarban'))::int AS aktiv,
                             COUNT(*) FILTER (WHERE o.status = 'Finalizat' AND COALESCE(o.finalized_at, o.updated_at) > NOW() - INTERVAL '90 days')::int AS lezart,
                             SUM(o.pret) FILTER (WHERE o.status = 'Finalizat' AND COALESCE(o.finalized_at, o.updated_at) > NOW() - INTERVAL '90 days') AS bevetel
                        FROM orders o WHERE o.company_id = $1 AND o.client_id = $2`, [ctx.cid, client.id]);
  const act = await q(`SELECT o.id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, o.status, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.nume_sofer
                         FROM orders o WHERE o.company_id = $1 AND o.client_id = $2 AND o.status NOT IN ('Anulat','Finalizat')
                        ORDER BY o.data_incarcare NULLS LAST LIMIT 20`, [ctx.cid, client.id]);
  const s0 = st[0] || {};
  let body = tiles([[String(s0.aktiv || 0), t.clientActive], [String(s0.lezart || 0), t.clientDone90], fin ? [fmtN(num(s0.bevetel), 2) + ' EUR', t.clientRevenue] : null]);
  if (act.length) body += table(['#', t.status, '', t.driver], act.map((o) => [{ __html: '<b>#' + esc(o.fuvar_no) + '</b>' }, t.st[o.status] || o.status,
    [cityOf(o.loc_incarcare), cityOf(o.loc_descarcare)].filter(Boolean).join(' → ') + (o.data_incarcare ? ' · ' + fmtD(o.data_incarcare instanceof Date ? iso(o.data_incarcare) : o.data_incarcare) : ''), o.nume_sofer || '—']), ctx.L);
  let html = '<div class="och-info">' + section('🏢', t.clientTitle + ' · ' + client.denumire, body) + '</div>';
  if (fin) html += await renderDebts(ctx, client);
  return html;
}

async function renderExpiries(ctx, plate) {
  const t = ctx.t;
  const p = [ctx.cid]; let w = ` AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'`;
  if (plate) { p.push(plate); w = ` AND UPPER(REGEXP_REPLACE(COALESCE(entity_label,''),'[^A-Za-z0-9]','','g')) = $2`; }
  const rows = await q(`SELECT entity_type, entity_label, doc_type, expiry_date, (expiry_date - CURRENT_DATE)::int AS days_left
                          FROM document_expiries WHERE company_id = $1${w} ORDER BY expiry_date LIMIT 40`, p);
  if (!rows.length) return '<div class="och-info">' + section('⏰', t.expTitle, '<div class="och-info-empty">' + esc(t.expNone) + '</div>') + '</div>';
  return '<div class="och-info">' + section('⏰', t.expTitle + (plate ? ' · ' + plate : ''), table([t.who, t.doc, t.expires, t.daysLeft],
    rows.map((r) => [r.entity_label || '—', r.doc_type, fmtD(r.expiry_date instanceof Date ? iso(r.expiry_date) : r.expiry_date),
      { __html: r.days_left < 0 ? '<b class="och-bad">' + esc(r.days_left) + '</b>' : esc(r.days_left) }]), ctx.L)) + '</div>';
}

async function renderService(ctx, plate) {
  const t = ctx.t;
  let items = [];
  try { items = await require('../handlers/fleetCompliance').computeServiceDueAlerts(ctx.cid); } catch (_) { items = []; }
  if (plate) items = items.filter((i) => plateNorm(i.rendszam) === plate);
  if (!items.length) return '<div class="och-info">' + section('🔧', t.srvTitle, '<div class="och-info-empty">' + esc(t.srvNone) + '</div>') + '</div>';
  return '<div class="och-info">' + section('🔧', t.srvTitle, table([t.vehicle, t.kmLeft, t.daysLeft, t.lastSrv],
    items.slice(0, 30).map((i) => [i.rendszam + (i.marca ? ' · ' + i.marca : ''), i.km_left != null ? fmtN(i.km_left) : '—', i.days_left != null ? String(i.days_left) : '—',
      (i.service_date ? fmtD(i.service_date instanceof Date ? iso(i.service_date) : i.service_date) : '—') + (i.description ? ' · ' + i.description : '')]), ctx.L)) + '</div>';
}

async function detectCompany(ctx, text) {
  const t = ctx.t;
  const f = fold(text);
  const raw = String(text || '');
  const hasQ = raw.includes('?') || QWORD_RE.test(f) || LISTQ_RE.test(f);
  if (BRIEF_RE.test(f)) {
    const ent = await findEntity(ctx.cid, text, {});
    if (!ent) return { reply: '☀️ ' + t.briefTitle, html: await renderBrief(ctx), questions: [], kind: 'brief' };
  }
  if (EXP_RE.test(f) && (hasQ || /\blejaro\w*|\bexpira\w*/.test(f))) {
    const ent = await findEntity(ctx.cid, text, {});
    return { reply: '⏰ ' + t.expTitle + (ent && ent.plate ? ' · ' + ent.plate_label : ''), html: await renderExpiries(ctx, ent && ent.plate ? ent.plate : null), questions: [], kind: 'expiry' };
  }
  if (SRV_RE.test(f) && hasQ) {
    const ent = await findEntity(ctx.cid, text, {});
    return { reply: '🔧 ' + t.srvTitle, html: await renderService(ctx, ent && ent.plate ? ent.plate : null), questions: [], kind: 'service' };
  }
  const isDebt = DEBT_RE.test(f);
  if (isDebt || hasQ) {
    const cl = await findClient(ctx.cid, text);
    if (cl && cl.ambiguous) return { reply: t.ambClient, html: '', questions: [{ text: t.ambClient, options: cl.ambiguous.map((n) => n + '?') }] };
    if (cl && (isDebt || /\b(fuvar\w*|curse\w*|cursa|transport\w*|helyzet\w*|statusz\w*|status\w*|situati\w*|comenz\w*|megrendel\w*)\b/.test(f))) {
      return { reply: '🏢 ' + t.clientTitle + ' · ' + cl.denumire, html: await renderClient(ctx, cl), questions: [], kind: 'client' };
    }
    if (isDebt && hasQ) {
      const per = debtPeriod(f, ctx);
      return { reply: '💰 ' + t.debtTitle + (per ? ' · ' + per.label : ''), html: await renderDebts(ctx, null, per), questions: [], kind: 'debt' };
    }
  }
  return null;
}

// ═════════════════ 4) ÁRAJÁNLAT ═════════════════
const QUOTE_RE = /\bmennyibe kerul\w*|\bmennyibe jon\w*|\bmennyibe lenne\b|\bmennyit kerj\w*|\barajanlat\w*|\bajanlat\w*|\bmennyi lenne az ar\w*|\bcat (ar )?costa\b|\bcat ar fi\b|\bcat cerem\b|\boferta\w*|\bofert\w*|\bcotatie\w*|\bcotatii\b|\bquote\b|\bhow much\b/;
const FROM_SUF = /(rol|rol|bol|tol)$/; // ékezet nélkül: -ról/-ről, -ból/-ből, -tól/-től
const TO_SUF = /(ra|re|ba|be|ig)$/;
const PLACE_STOP = /^(ajanlat\w*|arajanlat\w*|oferta\w*|ofert\w*|cotatie\w*|mennyibe|kerul\w*|kerulne|lenne|cat|costa|ar|fi|de|la|pana|quote|how|much|kb|cca|egy|un|o|fuvar\w*|cursa|transport\w*|ftl|ltl)$/;
function cleanPlace(s) {
  const w = String(s || '').replace(/[„"“”()]/g, ' ').split(/\s+/).filter(Boolean);
  while (w.length && (PLACE_STOP.test(fold(w[0])) || /^\d/.test(w[0]))) w.shift();
  while (w.length && (PLACE_STOP.test(fold(w[w.length - 1])) || /^\d/.test(w[w.length - 1]))) w.pop();
  return w.slice(-4).join(' ').replace(/[.,;:!?]+$/, '');
}
function parseRoute(text) {
  const r = _parseRoute(text);
  if (!r) return null;
  const from = cleanPlace(r.from); const to = cleanPlace(r.to);
  return from && to && fold(from) !== fold(to) ? { from, to } : null;
}
function _parseRoute(text) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  // 1) nyíl / kötőjel: „Cluj → Budapest", „Cluj - Budapest"
  let m = /([A-ZÀ-ŽĂÂÎȘȚŐŰ][^→>,;?]*?)\s*(?:→|->|=>| – | — | - )\s*([A-ZÀ-ŽĂÂÎȘȚŐŰ][^,;?]*?)(?=[,;?.]|\s\d|\s(?:kb|cca|~|\d)|$)/.exec(raw);
  if (m) return { from: m[1].trim(), to: m[2].trim() };
  // 2) RO: „de la Cluj la Budapesta"
  m = /\bde la ([A-ZÀ-ŽĂÂÎȘȚ][\wÀ-ž .-]*?) (?:la|pana la|până la) ([A-ZÀ-ŽĂÂÎȘȚ][\wÀ-ž .-]*?)(?=[,;?.]|\s\d|$)/.exec(raw);
  if (m) return { from: m[1].trim(), to: m[2].trim() };
  // 3) HU ragok: „Kolozsvárról Budapestre"
  const words = raw.split(' ');
  let from = null; let to = null;
  for (const w of words) {
    const clean = w.replace(/[^A-Za-zÀ-ž-]/g, '');
    if (!/^[A-ZÀ-ŽĂÂÎȘȚŐŰ]/.test(clean)) continue;
    const fw = fold(clean);
    if (PLACE_STOP.test(fw) || QUOTE_RE.test(fw)) continue;
    if (!from && FROM_SUF.test(fw) && fw.length > 4) from = clean.slice(0, -3);
    else if (!to && TO_SUF.test(fw) && fw.length > 3) to = clean.slice(0, -2);
  }
  // HU tővégi magánhangzó-nyúlás: Bicskére → Bicske, Szegedről ok.
  const unlen = (x) => x && x.replace(/á$/, 'a').replace(/é$/, 'e');
  if (from && to) return { from: unlen(from), to: unlen(to) };
  return null;
}
async function companyRatePerKm(cid) {
  const rows = await q(`SELECT (pret / NULLIF(km,0))::float AS r FROM orders
                         WHERE company_id = $1 AND status = 'Finalizat' AND km > 50 AND pret > 0
                           AND COALESCE(finalized_at, updated_at) > NOW() - INTERVAL '365 days'
                         ORDER BY COALESCE(finalized_at, updated_at) DESC LIMIT 400`, [cid]);
  const v = rows.map((r) => num(r.r)).filter((x) => x > 0.2 && x < 10).sort((a, b) => a - b);
  if (v.length < 5) return { rate: 1.3, n: v.length, def: true };
  return { rate: Math.round(v[Math.floor(v.length / 2)] * 100) / 100, n: v.length, def: false };
}
async function fuelParams(cid) {
  const c = await q(`SELECT AVG(fuel_per_100km)::float AS c FROM vehicles WHERE company_id = $1 AND fuel_per_100km > 15 AND fuel_per_100km < 50`, [cid]);
  const pr = await q(`SELECT (SUM((a->>'suma')::numeric) / NULLIF(SUM((a->>'litru')::numeric),0))::float AS p
                        FROM fuvarlevelek f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.alimentari)='array' THEN f.alimentari ELSE '[]'::jsonb END) a
                       WHERE f.company_id = $1 AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) > NOW() - INTERVAL '120 days'
                         AND COALESCE(a->>'tip','') NOT ILIKE '%adblue%'
                         AND (a->>'suma') ~ '^[0-9]+([.][0-9]+)?$' AND (a->>'litru') ~ '^[0-9]+([.][0-9]+)?$'`, [cid]);
  let price = num(pr[0] && pr[0].p); if (!(price > 4 && price < 15)) price = 7.5;
  let cons = num(c[0] && c[0].c); if (!(cons > 15)) cons = 30;
  return { cons, priceRon: price };
}
async function detectQuote(ctx, text) {
  const t = ctx.t;
  const f = fold(text);
  if (!QUOTE_RE.test(f)) return null;
  const route = parseRoute(text);
  if (!route) return { reply: t.quoteAsk, html: '', questions: [] };
  let est;
  try { est = await require('./routeEstimate').estimateRoute([{ type: 'loading', address: route.from }, { type: 'unloading', address: route.to }], ctx.cid); }
  catch (_) { return { reply: t.routeErr, html: '', questions: [] }; }
  const km = Math.round(num(est.km));
  if (!(km > 0)) return { reply: t.routeErr, html: '', questions: [] };
  let toll = null;
  try {
    const { featureEnabled } = require('./featureEnabled');
    if (await featureEnabled(ctx.cid, 'toll-becsles') && est.polyline) toll = await require('./tollEstimate').estimateFromPolyline(ctx.cid, est.polyline);
  } catch (_) { toll = null; }
  let bnr = 5;
  try { const b = num(await require('../services/bnr').fetchBnrEurRon()); if (b > 3) bnr = b; } catch (_) {}
  const fp = await fuelParams(ctx.cid);
  const liters = km * fp.cons / 100;
  const fuelEur = liters * fp.priceRon / bnr;
  const tollEur = toll ? num(toll.total) : 0;
  const cost = fuelEur + tollEur;
  const rr = await companyRatePerKm(ctx.cid);
  let price = Math.max(km * rr.rate, cost * 1.15);
  const wm = /(\d+(?:[.,]\d+)?)\s*(t|to|tonna\w*|tone|tona)\b/.exec(f);
  const tons = wm ? num(wm[1]) : null;
  price = Math.round(price / 10) * 10;
  const hours = est.durationSeconds ? Math.round(est.durationSeconds / 360) / 10 : null;
  let body = tiles([[fmtN(km) + ' km', t.distance], hours ? [fmtN(hours, 1) + ' ' + t.h, t.duration] : null,
    [fmtN(price) + ' EUR', '⭐ ' + t.suggested], [fmtN(cost, 0) + ' EUR', t.cost], [fmtN(price - cost, 0) + ' EUR', t.margin]]);
  const rows = [[t.fuel, fmtN(liters, 0) + ' L × ' + fmtN(fp.priceRon, 2) + ' RON ≈ ' + fmtN(fuelEur, 0) + ' EUR']];
  if (toll) rows.push([t.toll, fmtN(tollEur, 0) + ' EUR' + (Array.isArray(toll.byCountry) && toll.byCountry.length ? ' (' + toll.byCountry.map((c) => c.cc + ' ' + fmtN(num(c.cost), 0)).join(', ') + ')' : '')]);
  body += '<table class="och-info-t"><tbody>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</tbody></table>';
  body += '<div class="och-info-mut">' + esc(rr.def ? t.basisDefault(rr.rate) : t.basis(rr.n, rr.rate)) + (tons && tons < 12 ? ' ' + esc(t.weightNote) : '') + '</div>';
  const cl = await findClient(ctx.cid, text);
  const clientName = cl && !cl.ambiguous ? cl.denumire : '';
  const tok = mkTok(ctx, { t: 'quote', from: route.from.slice(0, 200), to: route.to.slice(0, 200), price, note: (tons ? tons + ' t · ' : '') + km + ' km' });
  const inpId = 'ochq_' + crypto.randomBytes(4).toString('hex');
  const prefill = (ctx.lang === 'hu' ? 'Fuvar: ' : 'Cursă: ') + route.from + ' → ' + route.to + (tons ? ', ' + tons + ' t' : '') + ', ' + price + ' EUR';
  body += '<div class="och-info-btns"><input class="och-act-input" id="' + inpId + '" type="text" maxlength="200" placeholder="' + esc(t.clientName) + '" value="' + esc(clientName) + '">'
    + '<button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(tok) + '" data-input="' + inpId + '" onclick="OrderChat.act(this)">' + esc(t.saveQuote) + '</button>'
    + '<button type="button" class="och-info-btn" data-text="' + esc(prefill) + '" onclick="OrderChat.prefill(this)">' + esc(t.toOrder) + '</button></div>';
  return { reply: '💶 ' + t.quoteTitle + ' — ' + route.from + ' → ' + route.to, html: '<div class="och-info">' + section('💶', t.quoteTitle + ' · ' + route.from + ' → ' + route.to, body) + '</div>', questions: [], kind: 'quote' };
}

// ═════════════════ 5) ÜZENET A SOFŐRNEK (WhatsApp) ═════════════════
const MSG_RE = /\bird meg\b|\birj (egy )?uzenet\w*|\birj neki\b|\buzend meg\b|\buzenj\w*|\bszolj\w*|\bkuldj (egy )?uzenet\w*|\bwhatsapp\w*|\btrimite(-i| i)? (un )?mesaj\w*|\bscrie(-i| i)\b|\bscrie lui\b|\banunta(-l| l)?\b|\bspune(-i| i)\b/;
async function detectMessage(ctx, text) {
  const t = ctx.t;
  const f = fold(text);
  if (!MSG_RE.test(f)) return null;
  const ent = await findEntity(ctx.cid, text, {});
  if (!ent || ent.ambiguous || !ent.email) return ent && ent.ambiguous ? { reply: t.whoAssign, html: '', questions: [] } : null;
  // Üzenet-szöveg: a „hogy" / „că" / „:" utáni rész.
  const raw = String(text || '');
  let msg = '';
  const m = /(?:\bhogy\b|\bcă\b|\bca\b|:)\s*(.+)$/i.exec(raw);
  if (m) msg = m[1].trim();
  if (!msg) return { reply: t.msgEmpty, html: '', questions: [] };
  msg = msg.charAt(0).toUpperCase() + msg.slice(1);
  if (!/[.!?]$/.test(msg)) msg += '.';
  const first = String(ent.name || '').split(' ').pop();
  const full = (ctx.lang === 'hu' ? 'Szia ' : 'Salut ') + first + '! ' + msg;
  const u = await q(`SELECT tel FROM users WHERE company_id = $1 AND LOWER(email) = $2`, [ctx.cid, ent.email]);
  let phone = null;
  try { phone = require('../handlers/whatsappChat')._normalizePhone(u[0] && u[0].tel); } catch (_) { phone = null; }
  // wa.me nemzetközi formátumot vár: 00… → …, belföldi 07… → 407… (RO).
  if (phone && /^00/.test(phone)) phone = phone.slice(2);
  else if (phone && /^0\d{9}$/.test(phone)) phone = '40' + phone.slice(1);
  let body = '<div class="och-msg-prev">' + esc(full) + '</div>';
  if (phone) {
    const url = 'https://wa.me/' + encodeURIComponent(phone) + '?text=' + encodeURIComponent(full);
    body += '<div class="och-info-btns"><a class="och-info-btn och-act-ok" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.msgOpen) + '</a></div>';
  } else body += '<div class="och-info-note">' + esc(t.noPhone(ent.name)) + '</div>';
  return { reply: '💬 ' + t.msgTitle + ' · ' + ent.name, html: '<div class="och-info">' + section('💬', t.msgTitle + ' · ' + ent.name, body) + '</div>', questions: [], kind: 'message' };
}

// ═════════════════ 7) DOKUMENTUM FELTÖLTÉSE FUVARHOZ ═════════════════
// „Számlát kell feltöltenem a legutóbb befejezett Vesna fuvarhoz" → a fuvart a
// SZERVER keresi meg (fuvarszám / ügyfél + legutóbbi lezárt), a kártya gombja a
// meglévő feltöltő ablakot nyitja (OrderDocs.openUpload). Az AI semmit nem kap.
const DOC_RE = /\b(szaml\w*|factur\w*|dokument\w*|document\w*|cmr\w*|pod|iratot|irat\w*|fotot|avizul|aviz|megbiz\w*|comanda de transport)\b/;
const UPL_RE = /\b(feltol\w*|toltsd? fel|toltok fel|toltenem fel|feltenn\w*|csatol\w*|incarc\w*|ataseaz\w*|atasez\w*|upload\w*|hozz?aad\w*|hozz?a ?ad\w*|add hozza|adaug\w*)\b/;
// A számlaSZÁM (adat) beírása nem dokumentum-feltöltés — azt a dokumentum-nyomkövetés kezeli.
const INVNO_RE = /szamlaszam\w*|\bnr\.? ?factur\w*|\bnumar(ul)? (de )?factur\w*/;
// „ehhez / ennek a fuvarnak / acest transport" — a beszélgetésben már szereplő fuvarra utal.
const REFER_RE = /\b(ehhez|ehez|ennek|erre|ezt a|ez a|ezen a|ugyanehhez|ugyanennek|emez|acest\w*|aceasta|aceeasi|acelasi|aceleiasi)\b/;
const VIEW_RE = /\b(hozd el\w*|hozd elo|hoz el\w*|hozza ele|mutasd\w*|mutass\w*|listazd|nyisd meg|nezd meg|mi van|adatai\w*|adatait|dokumentumai\w*|iratai\w*|arata\w*|afiseaza|deschide|documentele|datele)\b/;
const LATEST_RE = /\b(legutobb\w*|utolso\w*|legujabb\w*|ultim\w*|recent\w*|last)\b/;
const DOCSTOP = new Set(('szamla szamlat szamlak factura facturi feltolt feltoltes feltoltenem fuvar fuvarhoz fuvart fuvarnak legutobb legutobbi befejezett lezart utolso cegnek cegnel cegtol ceghez kell kellene dokumentum dokumentumot document documentul incarc incarca cursa cursei curse ultima finalizata firma firmei pentru trebuie')
  .split(' '));
function docType(f) {
  if (/\b(szaml|factur)/.test(f)) return 'invoice';
  if (/\bcmr/.test(f)) return 'cmr';
  if (/\b(pod|fotot|aviz)/.test(f)) return 'pod';
  if (/\b(megbiz|comanda)/.test(f)) return 'order';
  return 'other';
}

// A beszélgetés fókuszában lévő fuvar: a szövegben megadott szám, különben — ha a
// felhasználó rá utal („ehhez a fuvarhoz") vagy kell egy fuvar — az előzmény
// legutóbbi TELJES fuvarszáma (a csupasz számok az előzményben nem számítanak).
async function focusOrder(ctx, text, history, useHistory) {
  if (refIn(text)) return findOrder(ctx.cid, text, []);
  if (!useHistory) return null;
  for (const h of (history || []).slice(0, 8)) {
    const m = REF_RE.exec(String(h || ''));
    if (m) return findOrder(ctx.cid, m[1], []);
  }
  return null;
}
// Csak egy fuvarszám (pl. „A 47es", „#47", „CMD-2026-0047") — nincs benne más szándék.
const PURE_FILL = /^(a|az|fuvar\w*|cursa|comanda|nr|szam\w*|the|es|as|os|e|ez|azt|amelyik|kerem|legyen|deci|ok|igen|da)$/;
function isPureRef(text) {
  const s = String(text || '');
  if (!refIn(s) || s.length > 40) return false;
  const rest = fold(stripRef(s)).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return rest.every((w) => PURE_FILL.test(w));
}

// ═════════════════ 8) EGY FUVAR ADATAI + DOKUMENTUMAI ═════════════════
async function detectOrderView(ctx, text, history, draftActive) {
  const t = ctx.t;
  const f = fold(text);
  let pure = isPureRef(text);
  // Üres vázlatnál a TELJES fuvarszám a meglévő szerkesztő-utat nyitja (orderChat
  // loadOrderDraft) — azt nem vesszük el; a rövid szám („47es") vagy a folyamatban
  // lévő vázlat melletti szám viszont ide jön (különben az AI a vázlatba írná).
  if (pure && !draftActive && /\b([A-Z]{1,10}-\d{4}-\d{1,6}|CMD-[A-Z0-9]{8,14})\b/i.test(text)) pure = false;
  const view = VIEW_RE.test(f) && (/\b(dokument|document|irat|adat|date|fuvar|curs|szaml|factur|cmr)/.test(f) || REFER_RE.test(f));
  if (!pure && !view) return null;
  const fo = await focusOrder(ctx, text, history, view);
  if (!fo) return null;
  if (fo.ambiguous) return { reply: t.noOrder, html: '', questions: [{ text: t.noOrder, options: fo.ambiguous.options.slice(0, 5) }], focus: true };
  if (!fo.order) return { reply: t.orderNotFound(fo.ref), html: '', questions: [], focus: true };
  const o = fo.order;
  const docs = await callH(require('../handlers/orderDocs').orderDocSearch, ctx.req, [{ order_id: o.id, limit: 50 }]);
  const lbl = '#' + o.fuvar_no + (o.client ? ' · ' + o.client : '');
  const rows = [[t.vStatus, t.st[o.status] || o.status || '—'], [t.client, o.client || '—'],
    [t.vLoad, (o.loc_incarcare || '—') + (o.data_incarcare ? ' · ' + fmtD(o.data_incarcare) : '')],
    [t.vUnload, (o.loc_descarcare || '—') + (o.data_descarcare ? ' · ' + fmtD(o.data_descarcare) : '')],
    [t.vDriver, [o.nume_sofer, o.rendszam_camion].filter(Boolean).join(' · ') || '—']];
  if (await canSeeFinance(ctx.req) && o.pret != null) rows.push([t.vPrice, fmtN(num(o.pret), 2) + ' EUR']);
  let body = '<table class="och-info-t"><tbody>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</tbody></table>';
  const list = (docs && docs.ok && docs.rows) || [];
  body += '<div class="och-info-st" style="margin-top:10px">📎 ' + esc(t.viewDocs) + ' (' + list.length + ')</div>';
  body += list.length
    ? table([t.vType, t.vFile, t.vDate, ''], list.map((d) => [t.dt[d.doc_type] || d.doc_type || '—', (d.file_name || '—') + (d.ref_no ? ' · ' + d.ref_no : ''), fmtD(d.doc_date),
      { __html: safeId(d.id) ? '<button type="button" class="och-info-btn" onclick="OrderDocs.download(\'' + safeId(d.id) + '\')">⬇️</button>' : '' }]), ctx.L)
    : '<div class="och-info-empty">' + esc(t.viewNoDocs) + '</div>';
  body += '<div class="och-info-btns"><button type="button" class="och-info-btn och-act-ok" data-oid="' + esc(o.id) + '" data-lbl="' + esc(lbl) + '" data-dt="" onclick="OrderChat.docUp(this)">' + esc(t.docUp) + '</button>'
    + (safeId(o.id) ? '<button type="button" class="och-info-btn" onclick="EntityDetail.openOrder(\'' + safeId(o.id) + '\')">' + esc(t.viewDetails) + '</button>' : '') + '</div>';
  return { reply: '🚚 ' + t.viewTitle + ' #' + o.fuvar_no, html: '<div class="och-info">' + section('🚚', t.viewTitle + ' ' + lbl, body) + '</div>', questions: [], kind: 'order_view', focus: true };
}
async function detectDocUpload(ctx, text, history) {
  const t = ctx.t;
  const f = fold(text);
  if (!DOC_RE.test(f) || !UPL_RE.test(f) || INVNO_RE.test(f)) return null;
  const type = docType(f);
  const cols = `o.id, o.status, o.client, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.data_descarcare,
                COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no`;
  let rows = []; let latest = false;
  const fo = await focusOrder(ctx, text, history, REFER_RE.test(f));
  if (fo) {
    if (fo.order) rows = [fo.order];
    else if (fo.ambiguous) return { reply: t.noOrder, html: '', questions: [{ text: t.noOrder, options: fo.ambiguous.options.slice(0, 5).map((n) => text.replace(REF_RE, n).replace(HASH_RE, n)) }], focus: true };
    else return { reply: t.orderNotFound(fo.ref), html: '', questions: [], focus: true };
  } else {
    latest = LATEST_RE.test(f) || /\b(befejez\w*|lezar\w*|finaliz\w*|kesz)\b/.test(f);
    const p = [ctx.cid]; let w = '';
    const cl = await findClient(ctx.cid, text);
    if (cl && cl.ambiguous) return { reply: t.ambClient, html: '', questions: [{ text: t.ambClient, options: cl.ambiguous.map((n) => text + ' — ' + n) }] };
    if (cl) { p.push(cl.id, cl.denumire); w = ` AND (o.client_id = $2 OR LOWER(o.client) = LOWER($3))`; }
    else {
      // Az ügyfél csak a fuvaron (szövegként) szerepel — a szöveg jelentős szavai alapján.
      const words = f.split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !DOCSTOP.has(x) && !CLIENT_STOP.has(x)).slice(0, 4);
      if (words.length) { p.push(words.map((x) => '%' + x.replace(/[%_\\]/g, '\\$&') + '%')); w = ` AND o.client ILIKE ANY($2)`; }
    }
    const fin = latest ? ` AND o.status = 'Finalizat'` : '';
    const order = latest ? `o.finalized_at DESC NULLS LAST, o.created_at DESC` : `o.created_at DESC`;
    const sql = `SELECT ${cols} FROM orders o WHERE o.company_id = $1 AND o.status <> 'Anulat'${fin}${w} ORDER BY ${order} LIMIT ${latest ? 1 : 5}`;
    try { rows = await q(sql, p); } catch (e) { rows = []; }
  }
  const btn = (o) => '<button type="button" class="och-info-btn och-act-ok" data-oid="' + esc(o.id) + '" data-lbl="'
    + esc('#' + o.fuvar_no + (o.client ? ' · ' + o.client : '')) + '" data-dt="' + esc(type) + '" onclick="OrderChat.docUp(this)">' + esc(t.docUp) + '</button>';
  const route = (o) => (cityOf(o.loc_incarcare) || '—') + ' → ' + (cityOf(o.loc_descarcare) || '—');
  let body;
  if (!rows.length) {
    body = '<div class="och-info-empty">' + esc(t.docNone) + '</div><div class="och-info-btns"><button type="button" class="och-info-btn" data-dt="' + esc(type) + '" onclick="OrderChat.docUp(this)">' + esc(t.docOpenAny) + '</button></div>';
  } else {
    const head = rows.length === 1 ? (latest ? t.docLatest : '') : t.docPick;
    body = (head ? '<div class="och-info-mut">' + esc(head) + '</div>' : '')
      + table(['#', t.client, '', ''], rows.map((o) => [{ __html: '<b>#' + esc(o.fuvar_no) + '</b>' }, o.client || '—',
        route(o) + ' · ' + fmtD(o.data_descarcare || o.data_incarcare), { __html: btn(o) }]), ctx.L);
  }
  body += '<div class="och-info-note">' + esc(t.docHint) + '</div>';
  return { reply: '📎 ' + t.docTitle + (rows.length === 1 ? ' — #' + rows[0].fuvar_no : ''), html: '<div class="och-info">' + section('📎', t.docTitle, body) + '</div>', questions: [], kind: 'doc_upload', focus: true };
}

// ═════════════════ Fő belépési pont ═════════════════
// → null (nem ide tartozik) | { reply, html, questions, kind }
async function answer(req, text, history, lang, now, opts) {
  const cid = req.session.user.company_id;
  const ctx = { req, cid, uid: req.session.user.id, lang: lang === 'hu' ? 'hu' : 'ro', t: t_(lang), L: di._L[lang === 'hu' ? 'hu' : 'ro'] };
  now = now || new Date();
  return (await detectDocUpload(ctx, text, history))
    || (await detectOrderView(ctx, text, history, !!(opts && opts.draftActive)))
    || (await detectMessage(ctx, text))
    || (await detectSuggest(ctx, text, history))
    || (await detectQuote(ctx, text))
    || (await detectBulk(ctx, text, now))
    || (await detectFocusFollowUp(ctx, text, history, now))
    || (await detectAction(ctx, text, (opts && opts.draftActive) ? [] : history, now))
    || (await detectCompany(ctx, text));
}

// Rövid folytatás a beszélgetésben fókuszban lévő fuvarról („és kifizetve", „a számla lett
// kifizetve", „postáztuk", „számlaszám FCT-1") — fuvarszám nélkül, az előzmény utolsó teljes
// fuvarszámára. Aktív új-fuvar vázlat mellett is ide jön (nem az AI-hoz), mindig ✅-megerősítéssel.
async function detectFocusFollowUp(ctx, text, history, now) {
  const s = String(text || '');
  if (refIn(s) || s.length > 120) return null;
  const f = fold(s);
  if (NEG_PAY_RE.test(f) || s.includes('?') || LISTQ_RE.test(f)) return null; // kérdés / lekérdezés, nem rögzítés
  const pd = cleanOps(pdOps(s, now, false)); delete pd.finalize; delete pd.sync_finance;
  if (!ACT.pay.test(f) && !Object.keys(pd).length) return null;
  let ref = null;
  for (const h of (history || []).slice(0, 8)) { const m = REF_RE.exec(String(h || '')); if (m) { ref = m[1]; break; } }
  if (!ref) return null;
  const r = await detectAction(ctx, s, [ref], now, true);
  return r ? Object.assign(r, { focus: true }) : null;
}
async function brief(req, lang) {
  const ctx = { req, cid: req.session.user.company_id, uid: req.session.user.id, lang: lang === 'hu' ? 'hu' : 'ro', t: t_(lang), L: di._L[lang === 'hu' ? 'hu' : 'ro'] };
  return { reply: '☀️ ' + ctx.t.briefTitle, html: await renderBrief(ctx) };
}

module.exports = { answer, _docType: docType, _isPureRef: isPureRef, _refRange: refRange, brief, executeAction, signAction, verifyAction, parseRoute, dateIn, monthScope, pdOps, _T: T };
