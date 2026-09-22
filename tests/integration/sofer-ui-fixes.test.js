// ============================================================
//  Sofőr felület — 2026-09-21 átvizsgálás javításai (SOFER-AUDIT.md)
//
//  1. addAlimRow / addAchRow: a `value="..."` attribútum escape-elése
//     (az AI bon-kiolvasásból jövő idézőjeles helyszín/termék eddig
//     csonkolta a sort → adatvesztés egy pénzügyi bizonylaton).
//  2/3. `_SOF_MODALS` közös modál-nyilvántartás: a telefonos VISSZA gomb
//     a legfelső nyitott modált zárja, a pull-to-refresh pedig NEM indul
//     nyitott modál fölött. Regresszió-őr: a lista fedje le a sofer.html
//     ÖSSZES modálját.
// ============================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'public', 'sofer.js'), 'utf8');
// A kiadás-kategória választóját a KÖZÖS `public/expense-cat.js` adja —
// a sandboxba is betöltjük, hogy a valódi renderelési utat mérjük.
const CATS = fs.readFileSync(path.join(ROOT, 'public', 'expense-cat.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'sofer.html'), 'utf8');

function makeStore() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
function mkEl(id, reg) {
  const e = {
    id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [],
    classList: { l: new Set(), add(c){ this.l.add(c); }, remove(c){ this.l.delete(c); },
                 toggle(c,on){ on ? this.l.add(c) : this.l.delete(c); }, contains(c){ return this.l.has(c); } },
    appendChild(c){ this.children.push(c); return c; },
    insertBefore(c, r){ const i = this.children.indexOf(r); this.children.splice(i >= 0 ? i : this.children.length, 0, c); return c; },
    removeChild(c){ const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(){}, removeEventListener(){}, removeAttribute(){}, focus(){}, blur(){},
    getAttribute(){ return null; }, setAttribute(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    scrollIntoView(){}, remove(){ if (reg) delete reg[id]; }
  };
  return e;
}
function load() {
  const noop = () => {};
  const reg = {};
  const doc = {
    _registry: reg,
    getElementById: (id) => reg[id] || (reg[id] = mkEl(id, reg)),
    createElement: () => mkEl('_new', null),
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, body: mkEl('body', reg), documentElement: mkEl('doc', reg),
    visibilityState: 'visible'
  };
  const sb = {
    console,
    // A tesztek szinkronok; a valódi `setTimeout` csak függőben maradó
    // időzítőt hagyna a Jest-workerben (a sofer.js betöltéskor ütemez párat).
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Set, Map,
    parseInt, parseFloat, isNaN,
    localStorage: makeStore(), sessionStorage: makeStore(), indexedDB: undefined,
    navigator: { onLine: true, vibrate: noop, serviceWorker: { register: () => Promise.resolve() } },
    location: { href: '', pathname: '/sofer', search: '' },
    history: { pushState: noop, back: noop },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ result: null }) }),
    document: doc, alert: noop, confirm: () => true,
    t: (k) => k, toast: noop
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.window.addEventListener = noop;
  vm.createContext(sb);
  try { vm.runInContext(CATS, sb, { filename: 'expense-cat.js' }); } catch (e) {}
  try { vm.runInContext(SRC, sb, { filename: 'sofer.js' }); } catch (e) { /* top-level authMe */ }
  return sb;
}
process.on('unhandledRejection', () => {});

// ================================================================
//  1. Escape a tankolás / vásárlás sorokon
// ================================================================
describe('addAlimRow / addAchRow — value attribútum escape-elése', () => {
  test('idézőjeles helyszín (AI bon-kiolvasás) nem vágja el a value attribútumot', () => {
    const sb = load();
    sb.addAlimRow({ loc: 'MOL "Vest" Arad', litru: 120, km: 4000, suma: 700 });
    const row = sb.document.getElementById('alimentariContainer').children[0];
    // A nyers idézőjel nem maradhat benne — escape-elve kell megjelennie.
    expect(row.innerHTML).toContain('MOL &quot;Vest&quot; Arad');
    expect(row.innerHTML).not.toContain('MOL "Vest"');
  });

  test('vásárlás-sor: termék + helyszín is escape-elt', () => {
    const sb = load();
    sb.addAchRow({ produs: 'Ulei 5W-30 "Total"', loc: "Kaufland <Arad>", pret: 99 });
    const row = sb.document.getElementById('achizitiiContainer').children[0];
    expect(row.innerHTML).toContain('&quot;Total&quot;');
    expect(row.innerHTML).toContain('&lt;Arad&gt;');
    expect(row.innerHTML).not.toContain('<Arad>');
  });

  test('attribútum-injekció nem tud eseménykezelőt becsempészni', () => {
    const sb = load();
    sb.addAlimRow({ loc: '" onfocus="alert(1)" x="' });
    const row = sb.document.getElementById('alimentariContainer').children[0];
    // A VALÓDI attribútum-forma (`onfocus="`) nem jöhet létre: az idézőjelek
    // `&quot;`-ra escape-elődnek, így az egész csak inert szöveg a value-ban.
    expect(row.innerHTML).not.toContain('onfocus="');
    expect(row.innerHTML).toContain('value="&quot; onfocus=&quot;alert(1)&quot; x=&quot;"');
  });

  test('normál érték változatlanul megjelenik (nincs regresszió)', () => {
    const sb = load();
    sb.addAlimRow({ loc: 'OMV Timisoara', litru: 80 });
    const row = sb.document.getElementById('alimentariContainer').children[0];
    expect(row.innerHTML).toContain('value="OMV Timisoara"');
    expect(row.innerHTML).toContain('value="80"');
  });
});

// ================================================================
//  2/3. Közös modál-nyilvántartás
// ================================================================
describe('_SOF_MODALS — közös modál-nyilvántartás', () => {
  test('REGRESSZIÓ-ŐR: a sofer.html MINDEN modálja szerepel a listában', () => {
    const sb = load();
    const inHtml = new Set();
    let m; const re = /\sid="([a-zA-Z][\w]*Modal)"/g;
    while ((m = re.exec(HTML))) inHtml.add(m[1]);
    expect(inHtml.size).toBeGreaterThan(5);           // a parse tényleg talált modálokat
    const known = new Set(sb._SOF_MODALS.map(x => x.id));
    const missing = [...inHtml].filter(id => !known.has(id));
    expect(missing).toEqual([]);
  });

  test('minden nyilvántartott modál záró-útja létezik', () => {
    const sb = load();
    sb._SOF_MODALS.forEach(entry => {
      if (entry.close) expect(typeof sb[entry.close]).toBe('function');
      else expect(typeof entry.btn).toBe('string');
    });
  });

  test('_sofAnyModalOpen: zárt állapotban false, nyitottnál true', () => {
    const sb = load();
    expect(sb._sofAnyModalOpen()).toBe(false);
    sb.document.getElementById('companyInfoModal').style.display = 'flex';
    expect(sb._sofAnyModalOpen()).toBe(true);
  });

  test('_sofCloseTopModal: a Cégadatok modált bezárja (PTR + vissza gomb közös útja)', () => {
    const sb = load();
    const m = sb.document.getElementById('companyInfoModal');
    m.style.display = 'flex';
    expect(sb._sofCloseTopModal()).toBe(true);
    expect(m.style.display).toBe('none');
    expect(sb._sofAnyModalOpen()).toBe(false);
  });

  test('_sofCloseTopModal: nincs nyitott modál → false (a vissza gomb továbbnavigál)', () => {
    const sb = load();
    expect(sb._sofCloseTopModal()).toBe(false);
  });

  test('_sofCloseTopModal: több nyitott modálnál a LEGFELSŐ zárul be először', () => {
    const sb = load();
    const picker = sb.document.getElementById('orderPickerModal');
    const time   = sb.document.getElementById('sofTimeModal');
    picker.style.display = 'flex';
    time.style.display   = 'flex';
    sb._sofCloseTopModal();
    expect(time.style.display).toBe('none');          // a felső ment el
    expect(picker.style.display).toBe('flex');        // az alsó marad
    sb._sofCloseTopModal();
    expect(picker.style.display).toBe('none');
  });

  test('hibás záró-függvény esetén is eltűnik a modál (nem ragad a képernyőn)', () => {
    const sb = load();
    const m = sb.document.getElementById('hoModal');
    m.style.display = 'flex';
    sb.closeHandover = () => { throw new Error('boom'); };
    expect(sb._sofCloseTopModal()).toBe(true);
    expect(m.style.display).toBe('none');
  });
});
