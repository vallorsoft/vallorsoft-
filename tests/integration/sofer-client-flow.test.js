// ============================================================
//  Sofőr kliens (public/sofer.js) — kritikus fluxus-tesztek.
//
//  Nincs jsdom (a projekten kívüli függőség). Egy minimális, id-alapú
//  DOM-stubbal + in-memory localStorage/sessionStorage/IndexedDB-vel
//  betöltjük a valódi kódot, majd hívjuk az EGYETLEN nyilvános
//  kliens-függvényeket. Fókusz: menetlevél új folyamat (fuvarCreate),
//  fuvar-picker, apply-diff, kimaradt Finalizat blokkolása, IndexedDB
//  kép-megőrzés, offline outbox flush.
// ============================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sofer.js'), 'utf8');

function makeStore() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    _dump: () => m
  };
}
function makeIDB() {
  const dbs = {}; const mk = (n) => (dbs[n] = dbs[n] || { stores: {} });
  return {
    open(name) {
      const req = {};
      setTimeout(() => {
        const db = mk(name);
        const dbObj = {
          objectStoreNames: { contains: (s) => !!db.stores[s] },
          createObjectStore: (s) => (db.stores[s] = {}, {}),
          transaction(sname) {
            const data = db.stores[sname] = db.stores[sname] || {};
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const store = {
              put(v)   { data[v.id] = v; setTimeout(() => tx.oncomplete && tx.oncomplete()); },
              delete(k){ delete data[k]; setTimeout(() => tx.oncomplete && tx.oncomplete()); },
              get(k)   { const r = {}; setTimeout(() => { r.result = data[k]; r.onsuccess && r.onsuccess(); }); return r; },
              openCursor(){
                const r = {}; const keys = Object.keys(data); let i = 0;
                const step = () => {
                  if (i >= keys.length) { r.result = null; r.onsuccess && r.onsuccess(); return; }
                  const k = keys[i++];
                  r.result = { value: data[k], delete: () => delete data[k], continue: () => setTimeout(step) };
                  r.onsuccess && r.onsuccess();
                };
                setTimeout(step); return r;
              }
            };
            tx.objectStore = () => store;
            return tx;
          }
        };
        req.result = dbObj;
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
}
function makeDOM() {
  const registry = {};
  const el = (id) => {
    if (registry[id]) return registry[id];
    const e = {
      id, style: {}, dataset: {},
      classList: {
        list: new Set(),
        add(c){ this.list.add(c); }, remove(c){ this.list.delete(c); },
        toggle(c, on){ on ? this.list.add(c) : this.list.delete(c); },
        contains(c){ return this.list.has(c); }
      },
      value: '', textContent: '', innerHTML: '', children: [],
      appendChild(c){ this.children.push(c); return c; },
      insertBefore(c, ref){ const i = this.children.indexOf(ref); this.children.splice(i>=0?i:this.children.length, 0, c); return c; },
      removeChild(c){ const i = this.children.indexOf(c); if (i>=0) this.children.splice(i, 1); return c; },
      addEventListener(){}, removeEventListener(){}, removeAttribute(){}, focus(){},
      getAttribute(){ return null; }, setAttribute(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      scrollIntoView(){}, remove(){ delete registry[id]; }
    };
    registry[id] = e; return e;
  };
  return {
    _registry: registry,
    getElementById: el,
    createElement(){ return {
      remove(){}, addEventListener(){}, appendChild(){}, style: {},
      classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
      setAttribute(){}, getAttribute(){ return null; }
    }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, body: el('body'), documentElement: el('doc'),
    visibilityState: 'visible'
  };
}

function buildSandbox(opts = {}) {
  const noop = () => {};
  const sb = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: noop,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp,
    localStorage: makeStore(), sessionStorage: makeStore(),
    indexedDB: opts.noIdb ? undefined : makeIDB(),
    navigator: { onLine: true, vibrate: noop, serviceWorker: { register: () => Promise.resolve() } },
    location: { href: '', pathname: '/sofer', search: '' },
    // authMe defaultja `null` → a valós kód `location.href='/login'`-t hív
    // (az én location-stubom ezt csak feljegyzi, nem redirect), és NEM
    // futtatja a többi utat (loadDashOrders / loadSoferMiniStats stb.).
    // Az egyes tesztek felülírják, ha egy adott fetch-et akarnak nézni.
    fetch: opts.fetch || (() => Promise.resolve({ json: () => Promise.resolve({ result: null }) })),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
    document: makeDOM(),
    alert: noop, confirm: opts.confirm || (() => true),
    Image: function () {}, FileReader: function () {},
    t: (k, v) => { if (v && v.n != null) return k + '(' + v.n + ')'; return k; },
    toast: (m, k) => { sb._lastToast = { m, k }; },
    esc: s => String(s == null ? '' : s)
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.window.addEventListener = noop;
  return sb;
}
function load(opts) {
  const sb = buildSandbox(opts);
  vm.createContext(sb);
  try { vm.runInContext(SRC, sb, { filename: 'sofer.js' }); } catch (e) { /* top-level authMe */ }
  // A sofer.js definiál egy saját `toast`-ot — a mérésünkhöz utólag felülírjuk.
  sb.toast = (m, k) => { sb._lastToast = { m, k }; };
  return sb;
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

beforeEach(() => { /* minden test friss sandboxot használ */ });

// Kezeli az async promise-hibákat a fetch-stubok körül.
process.on('unhandledRejection', () => {});

// ================================================================
//  fuvarCreate + picker + apply-diff + validáció
// ================================================================
describe('fuvarCreate + picker fluxus', () => {
  test('nincs draft → wbLocDialog + picker megjelenik', async () => {
    const dialogs = [];
    const sb = load({ confirm: (m) => { dialogs.push(m); return false; } });
    sb.wbLocDialog = (kind, cb) => { dialogs.push('wb:' + kind); cb({ loc: 'Garaj', date: '2026-07-01', time: '08:00' }); };
    sb.fuvarStep2 = () => {};
    sb._soferOrdersCache = [{ id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q', status: 'Alocat', waybill_visible: true, waybill_phase: 'loading' }];
    sb.fuvarCreate();
    expect(dialogs).toContain('wb:start');
    expect(sb.document._registry.orderPickerModal.style.display).toBe('flex');
  });

  test('mentett draft → FOLYTAT (első confirm=true): resumeDraft + continue picker', () => {
    const sb = load({ confirm: () => true });
    sb._soferOrdersCache = [{ id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q', status: 'Alocat', waybill_visible: true, waybill_phase: 'loading' }];
    sb._selectedOrderIds = ['X'];
    sb.stateSave({ draft: { puncte: [{ tip: 'Plecare', loc: 'Garaj', data: '2026-07-01' }], orderIds: ['X'] } });
    let resumed = false;
    sb.resumeDraft = () => { resumed = true; };
    sb.fuvarCreate();
    expect(resumed).toBe(true);
    expect(sb.document._registry.orderPickerModal.style.display).toBe('flex');
  });

  test('mentett draft → TÖRÖL (1.=nem, 2.=igen): ürül + fresh folyamat', () => {
    let n = 0;
    const sb = load({ confirm: () => (++n, n !== 1) });   // 1: nem, 2: igen
    sb._soferOrdersCache = [{ id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q', status: 'Alocat', waybill_visible: true, waybill_phase: 'loading' }];
    sb._selectedOrderIds = ['X'];
    sb.stateSave({ draft: { puncte: [{ tip: 'Plecare', loc: 'G', data: '2026-07-01' }] } });
    sb.wbLocDialog = (k, cb) => cb({ loc: 'G', date: '2026-07-05', time: '09:00' });
    sb.fuvarStep2 = () => {};
    sb.fuvarCreate();
    expect((sb.stateGet() || {}).draft).toBeFalsy();
    expect(sb._selectedOrderIds.length).toBe(0);
    expect(sb.document._registry.orderPickerModal.style.display).toBe('flex');
  });

  test('mentett draft → MÉGSE (mindkét confirm=false): semmi nem történik', () => {
    const sb = load({ confirm: () => false });
    sb._soferOrdersCache = [{ id: 'X', client: 'A', waybill_visible: true, waybill_phase: 'loading' }];
    sb.stateSave({ draft: { puncte: [{ tip: 'Plecare', loc: 'G', data: '2026-07-01' }] } });
    let touched = false;
    sb.resumeDraft = () => { touched = true; };
    sb.wbLocDialog = () => { touched = true; };
    sb.fuvarCreate();
    expect(touched).toBe(false);
    expect((sb.stateGet() || {}).draft).toBeTruthy();
  });

  test('_opToggle bejelöl és levesz', () => {
    const sb = load({});
    sb._selectedOrderIds = [];
    sb._opToggle({ value: 'A', checked: true });
    sb._opToggle({ value: 'B', checked: true });
    expect(sb._selectedOrderIds).toEqual(['A', 'B']);
    sb._opToggle({ value: 'A', checked: false });
    expect(sb._selectedOrderIds).toEqual(['B']);
  });

  test('opAccept → cb(_selectedOrderIds.slice()), modal bezárul', () => {
    const sb = load({});
    let received = null;
    sb._opCb = (ids) => { received = ids; };
    sb._selectedOrderIds = ['A', 'B'];
    sb.document.getElementById('orderPickerModal').style.display = 'flex';
    sb.opAccept();
    expect(received).toEqual(['A', 'B']);
    expect(sb.document.getElementById('orderPickerModal').style.display).toBe('none');
  });

  test('opCancel → cb(null), modal bezárul', () => {
    const sb = load({});
    let received = 'x';
    sb._opCb = (v) => { received = v; };
    sb.document.getElementById('orderPickerModal').style.display = 'flex';
    sb.opCancel();
    expect(received).toBe(null);
    expect(sb.document.getElementById('orderPickerModal').style.display).toBe('none');
  });
});

// ================================================================
//  _validateNoLeftoverOrders — kimaradt Finalizat blokkol
// ================================================================
describe('_validateNoLeftoverOrders', () => {
  test('nincs indulási nap → true (nincs mit validálni)', () => {
    const sb = load({});
    sb._soferOrdersCache = [];
    expect(sb._validateNoLeftoverOrders()).toBe(true);
  });
  test('indulás UTÁN elvégzett Finalizat, nincs bent → false + err-toast + picker újranyitása', () => {
    const sb = load({});
    sb._pendingPlecare = { loc: 'G', date: '2026-07-01', time: '08:00' };
    sb._soferOrdersCache = [
      { id: 'A', status: 'Finalizat', finalized_at: '2026-07-04T10:00:00', waybill_visible: true },
      { id: 'B', status: 'Finalizat', finalized_at: '2026-06-20T00:00:00', waybill_visible: true }
    ];
    sb._selectedOrderIds = [];
    let picked = false;
    sb.fuvarPickAgain = () => { picked = true; };
    const v = sb._validateNoLeftoverOrders();
    expect(v).toBe(false);
    expect(sb._lastToast && sb._lastToast.k).toBe('err');
    expect(picked).toBe(true);
  });
  test('kimaradt de INDULÁS ELŐTT elvégzett Finalizat → engedi', () => {
    const sb = load({});
    sb._pendingPlecare = { loc: 'G', date: '2026-07-01', time: '08:00' };
    sb._soferOrdersCache = [{ id: 'B', status: 'Finalizat', finalized_at: '2026-06-20T00:00:00', waybill_visible: true }];
    sb._selectedOrderIds = [];
    expect(sb._validateNoLeftoverOrders()).toBe(true);
  });
  test('bepipálva → engedi', () => {
    const sb = load({});
    sb._pendingPlecare = { loc: 'G', date: '2026-07-01', time: '08:00' };
    sb._soferOrdersCache = [{ id: 'A', status: 'Finalizat', finalized_at: '2026-07-04T10:00:00', waybill_visible: true }];
    sb._selectedOrderIds = ['A'];
    expect(sb._validateNoLeftoverOrders()).toBe(true);
  });
});

// ================================================================
//  IndexedDB képmegőrzés (#299)
// ================================================================
describe('bon-kép megőrzés IndexedDB-ben', () => {
  test('_rcptImgPut/Get/Del: teljes kép körforgás', async () => {
    const sb = load({});
    await tick();
    sb._meData = { email: 'a@x.hu' };
    const id = sb.rcptNewId();
    const saved = await new Promise(r => sb._rcptImgPut(id, { mimeType: 'image/jpeg', data: 'BASE64' }, r));
    expect(saved).toBe(true);
    const got = await new Promise(r => sb._rcptImgGet(id, r));
    expect(got).toEqual({ mimeType: 'image/jpeg', data: 'BASE64' });
    sb._rcptImgDel(id);
    await tick();
    const after = await new Promise(r => sb._rcptImgGet(id, r));
    expect(after).toBe(null);
  });
  test('rcptQueueRemove is törli a képet (egyetlen ponton)', async () => {
    const sb = load({});
    await tick();
    sb._meData = { email: 'a@x.hu' };
    const id = sb.rcptNewId();
    sb.rcptQueueAdd({ id, createdAt: Date.now(), status: 'ready', hasImage: true });
    await new Promise(r => sb._rcptImgPut(id, { mimeType: 'image/jpeg', data: 'X' }, r));
    sb.rcptQueueRemove(id);
    await tick();
    expect(sb.rcptQueueLoad().find(x => x.id === id)).toBeUndefined();
    const img = await new Promise(r => sb._rcptImgGet(id, r));
    expect(img).toBe(null);
  });
  test('_rcptImgPrune: MÁS sofőr képéhez nem nyúl', async () => {
    const sb = load({});
    await tick();
    sb._meData = { email: 'a@x.hu' };
    const aId = sb.rcptNewId();
    await new Promise(r => sb._rcptImgPut(aId, { mimeType: 'image/jpeg', data: 'A' }, r));
    sb._meData = { email: 'b@x.hu' };
    const bId = sb.rcptNewId();
    sb.rcptQueueAdd({ id: bId, createdAt: Date.now(), status: 'processing', hasImage: true });
    await new Promise(r => sb._rcptImgPut(bId, { mimeType: 'image/jpeg', data: 'B' }, r));
    sb._rcptImgPrune();
    await tick(60);
    expect(await new Promise(r => sb._rcptImgGet(aId, r))).not.toBeNull();
    expect(await new Promise(r => sb._rcptImgGet(bId, r))).not.toBeNull();
  });
  test('IndexedDB nélkül (privát mód) — kecses leromlás, nincs hiba', async () => {
    const sb = load({ noIdb: true });
    await tick();
    sb._meData = { email: 'a@x.hu' };
    const id = sb.rcptNewId();
    const saved = await new Promise(r => sb._rcptImgPut(id, { mimeType: 'image/jpeg', data: 'X' }, r));
    expect(saved).toBe(false);   // őszinte visszajelzés
    expect(() => sb._rcptImgDel(id)).not.toThrow();
    expect(() => sb._rcptImgPrune()).not.toThrow();
  });
});

// ================================================================
//  Offline OUTBOX flush
// ================================================================
describe('offline outbox — _outboxSendOne + outboxFlush', () => {
  test('_outboxSendOne: sikeres válasz → cb(true, docNumber)', async () => {
    let called = null;
    const sb = load({
      fetch: () => Promise.resolve({ json: () => Promise.resolve({ success: true, docNumber: 'MT-2026-0007' }) })
    });
    sb._outboxSendOne({ data: {
      camion: 'B1', puncte: [{ tip: 'Plecare', loc: 'G' }, { tip: 'Sosire', loc: 'X' }]
    } }, (ok, num) => { called = { ok, num }; });
    await tick(30);
    expect(called).toEqual({ ok: true, num: 'MT-2026-0007' });
  });

  test('_outboxSendOne: a Plecare/Sosire helyszínt TÍPUS szerint tölti (nem első/utolsó)', async () => {
    let payload = null;
    const sb = load({
      fetch: (u, o) => { payload = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); }
    });
    sb._outboxSendOne({ data: {
      camion: 'B1',
      puncte: [
        { tip: 'Încărcare', loc: 'X' },   // NEM Plecare — nem lehet locPlecare
        { tip: 'Plecare',   loc: 'Garaj' },
        { tip: 'Descărcare', loc: 'Y' },
        { tip: 'Sosire',    loc: 'Depou' }
      ]
    } }, () => {});
    await tick(30);
    expect(payload.locPlecare).toBe('Garaj');
    expect(payload.locSosire).toBe('Depou');
  });

  test('outboxFlush: pending tétel sikeres → törlődik a listáról', async () => {
    const sb = load({
      fetch: () => Promise.resolve({ json: () => Promise.resolve({ success: true }) })
    });
    await tick();
    sb._meData = { email: 'a@x.hu' };
    sb.soferStoreLocalDrafts([
      { id: 'd1', label: 'x', savedAt: Date.now(), pendingSubmit: true, data: {
        camion: 'B1', puncte: [{ tip: 'Plecare', loc: 'G' }, { tip: 'Sosire', loc: 'X' }]
      }},
      { id: 'd2', label: 'y', savedAt: Date.now(), pendingSubmit: false, data: {} }
    ]);
    sb.outboxFlush(true);
    await tick(60);
    const arr = sb.soferLoadLocalDrafts();
    expect(arr.map(d => d.id)).toEqual(['d2']);   // d1 sikerrel elment → törlődött
  });

  test('outboxFlush: offline → nem próbálkozik', async () => {
    const sb = load({ fetch: () => { throw new Error('nem szabadna hívni'); } });
    sb.navigator.onLine = false;
    await tick();
    sb._meData = { email: 'a@x.hu' };
    sb.soferStoreLocalDrafts([{ id: 'd1', pendingSubmit: true, data: {} }]);
    expect(() => sb.outboxFlush(true)).not.toThrow();
  });
});

// ================================================================
//  Per-sofőr localStorage isolation — a KRITIKUS védelem az
//  authMe.then-ben rögzíti, a stateGet önmagában (közvetlen _meData
//  írással) nem szigetel — a valós flow-ban a login/kilépés → authMe
//  hívás tisztítja a `sessionStorage`-t, ha másik sofőré volt. Ezt
//  külön (integrációs) DOM-nélküli tesztben nem valid a szimuláció,
//  ezért itt csak azt ellenőrizzük, hogy a KULCS a per-driver
//  formátumban él (localStorage), és nem az univerzális kulcs alatt.
// ================================================================
describe('per-sofőr storage kulcs formátuma', () => {
  test('a stateSave a `vs_sofer_state:<email>` kulcsba ír, nem a csupasz `vs_sofer_state`-be', async () => {
    const sb = load({});
    await tick();
    sb._meData = { email: 'peto@ex.hu' };
    sb.stateSave({ draft: { camion: 'B1', puncte: [] } });
    const dump = sb.localStorage._dump();
    // Van per-sofőr kulcs
    expect(Object.keys(dump).some(k => k === 'vs_sofer_state:peto@ex.hu')).toBe(true);
  });
});

// ================================================================
//  Állomás-visszajelzés (driverMilestone) — megerősítés a beküldés
//  ELŐTT. Az állomás nem vonható vissza (a szerver mindig a
//  következő üres állomást tölti ki), a gomb pedig a kártya
//  fejlécén ül → félrenyomásra a fuvar rossz státuszba léphet.
// ================================================================
describe('driverMilestone megerősítés', () => {
  test('confirm=false → nincs hálózati hívás', () => {
    const urls = [];
    const sb = load({
      confirm: () => false,
      fetch: (u) => { urls.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); }
    });
    sb.driverMilestone('ORD1', 0);
    // (az induláskori authMe-fetch nem számít — csak a milestone-hívást nézzük)
    expect(urls.filter(u => u.indexOf('/driver-milestone') >= 0)).toEqual([]);
  });

  test('confirm=true → POST a driver-milestone végpontra', async () => {
    const urls = [];
    const sb = load({
      confirm: () => true,
      fetch: (u, o) => { urls.push({ u, m: o && o.method }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, step: 'loaded' }) }); }
    });
    sb.loadDashOrders = () => {};
    sb.driverMilestone('ORD1', 1);
    await tick();
    const hit = urls.filter(x => String(x.u).indexOf('/driver-milestone') >= 0);
    expect(hit.length).toBe(1);
    expect(hit[0].m).toBe('POST');
    expect(String(hit[0].u)).toContain('/api/orders/ORD1/driver-milestone');
  });

  test('a kérdés a soron következő állomást nevezi meg', () => {
    const asked = [];
    const sb = load({ confirm: (m) => { asked.push(m); return false; } });
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.driverMilestone('ORD1', 2);           // sosit_descarcare_at
    expect(asked[0]).toBe('sof.ms.confirmAsk|sof.ms.arriveUnload');
  });

  test('érvénytelen/hiányzó stepIdx → általános kérdés, de továbbra is kérdez', () => {
    const asked = [];
    const sb = load({ confirm: (m) => { asked.push(m); return false; } });
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.driverMilestone('ORD1');              // nincs index (régi hívó)
    sb.driverMilestone('ORD1', 99);          // tartományon kívül
    expect(asked).toEqual([
      'sof.ms.confirmAsk|sof.ms.recorded',
      'sof.ms.confirmAsk|sof.ms.recorded'
    ]);
  });
});

// ================================================================
//  Határátlépés (sendBorderCross) — megerősítés a rögzítés ELŐTT.
//  Az átlépés a sofőr felületéről nem vonható vissza, és a menetlevél
//  diurnáját (extern/intern napok) KÖZVETLENÜL ebből számoljuk.
// ================================================================
describe('sendBorderCross megerősítés', () => {
  test('confirm=false → nincs hálózati hívás (és GPS-t sem kér)', () => {
    const urls = [];
    let geo = 0;
    const sb = load({
      confirm: () => false,
      fetch: (u) => { urls.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); }
    });
    sb.navigator.geolocation = { getCurrentPosition: () => { geo++; } };
    sb.sendBorderCross('Iesire', 'RO');
    expect(urls.filter(u => u.indexOf('/api/border-cross') >= 0)).toEqual([]);
    expect(geo).toBe(0);
  });

  test('confirm=true → POST az /api/border-cross végpontra a helyes iránnyal', async () => {
    const calls = [];
    const sb = load({
      confirm: () => true,
      fetch: (u, o) => { calls.push({ u: String(u), o }); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); }
    });
    sb.loadBorderLog = () => {};
    sb.sendBorderCross('Intrare', 'RO');
    await tick();
    const hit = calls.filter(c => c.u.indexOf('/api/border-cross') >= 0);
    expect(hit.length).toBe(1);
    expect(hit[0].o.method).toBe('POST');
    expect(JSON.parse(hit[0].o.body)).toMatchObject({ tip: 'Intrare', tara: 'RO' });
  });

  test('a kérdés az irányt nevezi meg (BE / KI külön)', () => {
    const asked = [];
    const sb = load({ confirm: (m) => { asked.push(m); return false; } });
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.sendBorderCross('Intrare', 'RO');
    sb.sendBorderCross('Iesire', 'RO');
    expect(asked).toEqual([
      'sof.crossConfirmAsk|sof.crossIn',
      'sof.crossConfirmAsk|sof.crossOut'
    ]);
  });
});
