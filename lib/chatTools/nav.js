// ============================================================
//  VallorSoft — lib/chatTools/nav.js
//  Navigáció (fül / ablak megnyitása), súgó, és a meglévő vázlat-utak
//  (új fuvar szövegből, e-mail) delegálása.
// ============================================================
'use strict';

const core = require('./core');
const TABS = require('./navTabs.json');

const { esc, fold } = core.fmt;

function findTab(raw, role) {
  const s = String(raw || '').trim();
  const f = fold(s);
  const ok = TABS.filter((t) => t.roles.includes(role));
  let hit = ok.find((t) => t.tab === s) || ok.find((t) => fold(t.hu) === f || fold(t.ro) === f);
  if (!hit) hit = ok.find((t) => f && (fold(t.hu).includes(f) || fold(t.ro).includes(f) || f.includes(fold(t.hu)) || f.includes(fold(t.ro))));
  return hit || null;
}

const L = (hu, ro) => ({ hu, ro });

// Kliens-oldali UI-parancsok fehérlistája (public/order-chat.js runUi).
const UI_OPS = ['tab', 'openOrder', 'editOrder', 'postDelivery', 'orderEmail', 'vehicle', 'driver', 'client', 'decont', 'handover', 'assignment', 'svDecide', 'orderWizard', 'orderImport', 'gdprExport', 'carrierDocs'];

const GROUPS = [
  { icon: '🚚', hu: 'Fuvarok', ro: 'Curse', ex: L(['Hol tart a 0042?', 'Rendeld a 0042-t Gondosnak', 'A 0042 lerakása holnapra csúszik', 'Töröld a 0051-et', 'Mutasd a kiosztásra váró fuvarokat'], ['Unde e cursa 0042?', 'Alocă 0042 lui Gondos', 'Descărcarea 0042 se mută pe mâine', 'Anulează cursa 0051', 'Arată cursele nealocate']) },
  { icon: '🛻', hu: 'Flotta', ro: 'Flotă', ex: L(['Mi jár le 30 napon belül?', 'A B123ABC ITP-je 2027-03-15-én jár le', 'Melyik autónak esedékes a szerviz?', 'Hol van a B123ABC?'], ['Ce expiră în 30 de zile?', 'ITP B123ABC expiră pe 2027-03-15', 'Ce vehicul are revizia scadentă?', 'Unde e B123ABC?']) },
  { icon: '👷', hu: 'Sofőrök', ro: 'Șoferi', ex: L(['Gondosnak diurna 70 euró okt 1-6', 'Mennyivel tartozunk Gondosnak?', 'Fizess ki Gondosnak 500 eurót'], ['Lui Gondos diurnă 70 euro 1-6 oct', 'Cât îi datorăm lui Gondos?', 'Plătește-i lui Gondos 500 euro']) },
  { icon: '💶', hu: 'Pénzügy', ro: 'Finanțe', ex: L(['Mennyi a kintlévőség?', 'Mi a mai BNR árfolyam?', 'Mennyi volt a bevétel szeptemberben?'], ['Cât sunt creanțele?', 'Care e cursul BNR azi?', 'Cât a fost venitul în septembrie?']) },
  { icon: '🏢', hu: 'Ügyfelek, alvállalkozók, dokumentumok', ro: 'Clienți, subcontractori, documente', ex: L(['Vedd fel ügyfélnek a 47859317 CUI-t', 'Rögzítsd a Trans Rapid 1200 eurós számláját a 0042-höz', 'Adj egy számot az FCT mappából', 'Mutasd a 0042 dokumentumait'], ['Adaugă clientul cu CUI 47859317', 'Înregistrează factura Trans Rapid de 1200 euro pentru 0042', 'Dă-mi un număr din dosarul FCT', 'Arată documentele cursei 0042']) },
  { icon: '🧰', hu: 'Tömeges, UIT, kalkuláció, beállítások', ro: 'În masă, UIT, calcul, setări', ex: L(['A kijelölteket jelöld fizetettnek', 'A 0042 UIT-kódja AB12CD34EF56GH78', 'Mennyibe kerül nekünk a 0042, ha a gázolaj 7,2 lej?', 'Készíts e-CMR-t a 0042-höz', 'A havi bevételi cél legyen 120000 euró'], ['Marchează selectatele ca plătite', 'Codul UIT pentru 0042 este AB12CD34EF56GH78', 'Cât ne costă cursa 0042 la motorina de 7,2 lei?', 'Creează e-CMR pentru 0042', 'Ținta lunară de venit 120000 euro']) },
  { icon: '📨', hu: 'Beérkező kérések, menetlevél, ajánlat, e-mail', ro: 'Cereri primite, foaie de parcurs, ofertă, e-mail', ex: L(['Milyen beérkező megrendelések vannak?', 'Hagyd jóvá a Bilka kérését', 'Készíts menetlevelet Gondosnak október 1-től 5-ig', 'Készíts ajánlatot a Bilkának Brassó–Budapest 1200 euróért', 'Írj a Bilkának, hogy küldöm az árlistát'], ['Ce comenzi noi au venit?', 'Aprobă cererea Bilka', 'Fă o foaie de parcurs pentru Gondos 1–5 octombrie', 'Fă o ofertă pentru Bilka Brașov–Budapesta 1200 euro', 'Scrie-i lui Bilka că trimit lista de prețuri']) },
  { icon: '👥', hu: 'Munkatársak, meghívók, portálok', ro: 'Colegi, invitații, portaluri', ex: L(['Hívd meg Kiss Pétert sofőrnek, kiss.peter@gmail.com', 'Tiltsd le Kiss Pétert', 'Kiss Péter telefonszáma legyen 0740123456', 'Hívd meg a Bilkát az ügyfél-portálra, logistica@bilka.ro', 'Vedd fel új ügyfélnek a Müller GmbH-t, Németország'], ['Invită-l pe Ion ca șofer, ion@gmail.com', 'Blochează-l pe Ion', 'Telefonul lui Ion să fie 0740123456', 'Invită Bilka în portal, logistica@bilka.ro', 'Adaugă clientul Müller GmbH, Germania']) },
  { icon: '🧰', hu: 'Karbantartás', ro: 'Întreținere', ex: L(['Vegyél fel külső sofőrt: Kovács Béla, Rapid Kft', 'Hol vannak km-hézagok a menetlevelekben?', 'A régi sofőr menetleveleit tedd át Gondosra', 'Kapcsold ki az AI bon-kiolvasást', 'Adj számla-kiállítási jogot a managernek', 'Frissítsd a postafiókot'], ['Adaugă șofer extern: Ion Pop, Rapid SRL', 'Unde sunt goluri de km în foile de parcurs?', 'Mută foile șoferului vechi pe Gondos', 'Oprește citirea AI a bonurilor', 'Dă-i managerului drept de facturare', 'Sincronizează căsuța de e-mail']) },
  { icon: '🛠️', hu: 'Dokumentum, kampány, GDPR', ro: 'Documente, campanii, GDPR', ex: L(['Írd alá a 0042 e-CMR-jét fuvarozóként', 'Küldd ki az Októberi akció sablont a párosított kontaktoknak', 'Importálni szeretnék fuvarokat CSV-ből', 'Pecsételni szeretnék egy PDF-et', 'Mi az előfizetésem állapota?', 'Milyen integrációk vannak beállítva?', 'Küldj havonta statisztika-riportot a fonok@ceg.ro címre'], ['Semnează e-CMR 0042 ca transportator', 'Trimite șablonul Ofertă octombrie contactelor asociate', 'Vreau să import curse din CSV', 'Vreau să ștampilez un PDF', 'Care e starea abonamentului?', 'Ce integrări sunt configurate?', 'Trimite lunar raport statistic la sef@firma.ro']) },
  { icon: '🗂️', hu: 'Törzsadat és beállítás', ro: 'Date de bază și setări', ex: L(['A Rapid Kft fizetési határideje legyen 45 nap', 'Vond vissza Kiss Péter meghívóját', 'Tiltsd le a logistica@bilka.ro portál-hozzáférését', 'Küldd el a számla-értesítőt a Bilkának az FCT-123 számláról', 'Ausztriában az útdíj legyen 0,45 €/km', 'Milyen leveleket küldtünk ki a héten?'], ['Termenul de plată la Rapid SRL să fie 45 de zile', 'Retrage invitația lui Ion', 'Blochează accesul în portal pentru logistica@bilka.ro', 'Trimite notificarea de factură FCT-123 către Bilka', 'În Austria taxa să fie 0,45 €/km', 'Ce e-mailuri am trimis săptămâna asta?']) },
  { icon: '↩️', hu: 'Több lépés, visszavonás', ro: 'Mai mulți pași, anulare', ex: L(['A 0042 ára 1400 legyen és add Gondosnak', 'Vond vissza az előzőt'], ['Prețul 0042 să fie 1400 și alocă-l lui Gondos', 'Anulează ultima operațiune']) },
  { icon: '🧭', hu: 'Navigáció', ro: 'Navigare', ex: L(['Nyisd meg a tervezőtáblát', 'Mutasd a 0042 adatlapját', 'Ugorj a lejáratokra'], ['Deschide planificatorul', 'Arată fișa cursei 0042', 'Mergi la scadențe']) },
];

module.exports = [
  {
    name: 'nav.open', domain: 'nav', kind: 'ui',
    desc: L('Egy menüpont / oldal megnyitása a konzolon. page = az oldal neve vagy kulcsa: ' + TABS.map((t) => t.tab).join(', '), 'Deschide o pagină din consolă. page = numele sau cheia paginii: ' + TABS.map((t) => t.tab).join(', ')),
    examples: L(['nyisd meg a tervezőtáblát', 'menjünk a lejáratokhoz'], ['deschide planificatorul', 'mergi la scadențe']),
    params: { page: { type: 'text', required: true, max: 60 } },
    async run(ctx, a) {
      const tab = findTab(a.page, ctx.user.pozicio);
      const t = core.tx(ctx.lang);
      if (!tab) return { ok: false, err: ctx.lang === 'hu' ? 'Nem találok ilyen menüpontot: ' + a.page : 'Nu găsesc pagina: ' + a.page };
      if (!(await core.canUse(ctx.req, { feature: tab.tab }, ctx.permCache))) return { ok: false, err: t.noAccess };
      return { reply: t.opened(tab[ctx.lang] || tab.hu), ui: { op: 'tab', tab: tab.tab } };
    },
  },
  {
    name: 'help.capabilities', domain: 'nav', kind: 'read',
    desc: L('Súgó: mit tud a chat, példa-mondatokkal.', 'Ajutor: ce știe chatul, cu exemple.'),
    examples: L(['mit tudsz?', 'súgó'], ['ce știi să faci?', 'ajutor']),
    async run(ctx) {
      const lg = ctx.lang;
      const html = '<div class="och-info">' + GROUPS.map((g) => core.card.section(g.icon, g[lg],
        '<div class="och-info-btns">' + g.ex[lg].map((e) => '<button type="button" class="och-info-btn" data-text="' + esc(e) + '" onclick="OrderChat.prefill(this)">' + esc(e) + '</button>').join('') + '</div>')).join('') + '</div>';
      return { reply: lg === 'hu' ? 'Szinte mindent elérsz innen, amit a menüből. Néhány példa — koppints rá, és küldd el:' : 'Aproape tot ce e în meniu se poate face de aici. Câteva exemple — atinge și trimite:', html };
    },
  },
  { name: 'order.create_chat', domain: 'orders', kind: 'delegate', delegate: 'draft', feature: 'orders-form',
    desc: L('ÚJ fuvar létrehozása szabad szövegből (felrakó, lerakó, dátum, ár…) — a chat fuvar-vázlata.', 'Creare cursă NOUĂ din text liber (încărcare, descărcare, dată, preț…).'),
    examples: L(['holnap Aradról Győrbe 22 raklap 1200 euró'], ['mâine Arad – Győr 22 paleți 1200 euro']) },
  { name: 'order.edit_chat', domain: 'orders', kind: 'delegate', delegate: 'edit',
    desc: L('Egy meglévő fuvar betöltése a chat-szerkesztőbe több mező átírásához (pl. „szerkesszük a 0042-t").', 'Încarcă o cursă existentă în editorul din chat (ex. „editează cursa 0042").'),
    params: { order: { type: 'text', max: 40 } } },
  { name: 'mail.compose', domain: 'mail', kind: 'delegate', delegate: 'mail',
    desc: L('E-mail / levél írása és küldése (fuvarról vagy általános).', 'Scrie și trimite un e-mail (despre cursă sau general).'),
    examples: L(['írj levelet a Bilkának a 0042-ről'], ['scrie un e-mail către Bilka despre 0042']) },
];
module.exports.UI_OPS = UI_OPS;
module.exports.findTab = findTab;
module.exports.TABS = TABS;
