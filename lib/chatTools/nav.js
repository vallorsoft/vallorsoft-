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
const UI_OPS = ['tab', 'openOrder', 'editOrder', 'postDelivery', 'orderEmail', 'vehicle', 'driver', 'client', 'decont', 'handover', 'assignment', 'svDecide', 'orderWizard'];

const GROUPS = [
  { icon: '🚚', hu: 'Fuvarok', ro: 'Curse', ex: L(['Hol tart a 0042?', 'Rendeld a 0042-t Gondosnak', 'A 0042 lerakása holnapra csúszik', 'Töröld a 0051-et', 'Mutasd a kiosztásra váró fuvarokat'], ['Unde e cursa 0042?', 'Alocă 0042 lui Gondos', 'Descărcarea 0042 se mută pe mâine', 'Anulează cursa 0051', 'Arată cursele nealocate']) },
  { icon: '🛻', hu: 'Flotta', ro: 'Flotă', ex: L(['Mi jár le 30 napon belül?', 'A B123ABC ITP-je 2027-03-15-én jár le', 'Melyik autónak esedékes a szerviz?', 'Hol van a B123ABC?'], ['Ce expiră în 30 de zile?', 'ITP B123ABC expiră pe 2027-03-15', 'Ce vehicul are revizia scadentă?', 'Unde e B123ABC?']) },
  { icon: '👷', hu: 'Sofőrök', ro: 'Șoferi', ex: L(['Gondosnak 6 nap diurna 70 euró', 'Mennyivel tartozunk Gondosnak?', 'Fizess ki Gondosnak 500 eurót'], ['Lui Gondos 6 zile diurnă 70 euro', 'Cât îi datorăm lui Gondos?', 'Plătește-i lui Gondos 500 euro']) },
  { icon: '💶', hu: 'Pénzügy', ro: 'Finanțe', ex: L(['Mennyi a kintlévőség?', 'Mi a mai BNR árfolyam?', 'Mennyi volt a bevétel szeptemberben?'], ['Cât sunt creanțele?', 'Care e cursul BNR azi?', 'Cât a fost venitul în septembrie?']) },
  { icon: '🏢', hu: 'Ügyfelek, alvállalkozók, dokumentumok', ro: 'Clienți, subcontractori, documente', ex: L(['Vedd fel ügyfélnek a 47859317 CUI-t', 'Rögzítsd a Trans Rapid 1200 eurós számláját a 0042-höz', 'Adj egy számot az FCT mappából', 'Mutasd a 0042 dokumentumait'], ['Adaugă clientul cu CUI 47859317', 'Înregistrează factura Trans Rapid de 1200 euro pentru 0042', 'Dă-mi un număr din dosarul FCT', 'Arată documentele cursei 0042']) },
  { icon: '🧰', hu: 'Tömeges, UIT, kalkuláció, beállítások', ro: 'În masă, UIT, calcul, setări', ex: L(['A kijelölteket jelöld fizetettnek', 'A 0042 UIT-kódja AB12CD34EF56GH78', 'Mennyibe kerül nekünk a 0042, ha a gázolaj 7,2 lej?', 'Készíts e-CMR-t a 0042-höz', 'A havi bevételi cél legyen 120000 euró'], ['Marchează selectatele ca plătite', 'Codul UIT pentru 0042 este AB12CD34EF56GH78', 'Cât ne costă cursa 0042 la motorina de 7,2 lei?', 'Creează e-CMR pentru 0042', 'Ținta lunară de venit 120000 euro']) },
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
