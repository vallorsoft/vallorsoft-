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
describe('fuvarCreate + auto-collect fluxus', () => {
  // 2026-08-21: fresh menetlevél NEM nyit pickert; a Plecare után
  // automatikusan begyűjti az elvégzett (done_at NOT NULL, waybilled_at IS
  // NULL) stopokat, és egyenesen step2-re lép.
  test('nincs draft → wbLocDialog + auto-collect + fuvarStep2 (picker NEM nyílik)', async () => {
    const dialogs = [];
    const sb = load({ confirm: (m) => { dialogs.push(m); return false; } });
    sb.wbLocDialog = (kind, cb) => { dialogs.push('wb:' + kind); cb({ loc: 'Garaj', date: '2026-07-01', time: '08:00' }); };
    let step2Called = false;
    sb.fuvarStep2 = () => { step2Called = true; };
    sb._soferOrdersCache = [{
      id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q',
      status: 'In Curs', waybill_visible: true, waybill_phase: 'loading',
      stops: [
        { id: 's1', kind: 'pickup',   stop_index: 0, loc: 'p', done_at: '2026-07-01T09:00:00', waybilled_at: null },
        { id: 's2', kind: 'delivery', stop_index: 0, loc: 'q', done_at: null,                    waybilled_at: null }
      ]
    }];
    sb.fuvarCreate();
    expect(dialogs).toContain('wb:start');
    expect(step2Called).toBe(true);
    // A picker NEM nyílik meg fresh-módban
    expect(sb.document.getElementById('orderPickerModal').style.display).not.toBe('flex');
    // Auto-collect az elvégzett pickup-ot felvette
    expect(sb._selectedOrderIds).toEqual(['X']);
    expect(sb._autoStopFilter && sb._autoStopFilter.byOrder && sb._autoStopFilter.byOrder.X.s1).toBe(true);
    expect(sb._autoStopFilter.byOrder.X.s2).toBeUndefined(); // nyitott stop kimarad
  });

  test('nincs draft, semmi elvégzett → auto-collect üres, mégis step2 (üres menetlevél)', async () => {
    const sb = load({ confirm: () => false });
    sb.wbLocDialog = (kind, cb) => cb({ loc: 'Garaj', date: '2026-07-01', time: '08:00' });
    let step2Called = false;
    sb.fuvarStep2 = () => { step2Called = true; };
    sb._soferOrdersCache = [{
      id: 'X', status: 'Alocat', waybill_visible: true, waybill_phase: 'loading',
      stops: [{ id: 's1', kind: 'pickup', stop_index: 0, loc: 'p', done_at: null, waybilled_at: null }]
    }];
    sb.fuvarCreate();
    expect(step2Called).toBe(true);
    expect(sb._selectedOrderIds).toEqual([]);
    expect(sb._autoStopFilter).toBe(null);
  });

  test('mentett draft → FOLYTAT: resumeDraft, picker NEM nyílik', () => {
    const sb = load({ confirm: () => true });
    sb._soferOrdersCache = [{ id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q', status: 'Alocat', waybill_visible: true, waybill_phase: 'loading' }];
    sb._selectedOrderIds = ['X'];
    sb.stateSave({ draft: { puncte: [{ tip: 'Plecare', loc: 'Garaj', data: '2026-07-01' }], orderIds: ['X'] } });
    let resumed = false;
    sb.resumeDraft = () => { resumed = true; };
    sb.fuvarCreate();
    expect(resumed).toBe(true);
    // A picker NEM nyílik meg automatikusan; a sofőr utólag a
    // „✏️ Fuvarok kezelése" gombbal hívhatja elő.
    expect(sb.document.getElementById('orderPickerModal').style.display).not.toBe('flex');
  });

  test('mentett draft → TÖRÖL (1.=nem, 2.=igen): ürül + fresh auto-collect', () => {
    let n = 0;
    const sb = load({ confirm: () => (++n, n !== 1) });   // 1: nem, 2: igen
    sb._soferOrdersCache = [{
      id: 'X', client: 'A', loc_incarcare: 'p', loc_descarcare: 'q',
      status: 'In Curs', waybill_visible: true, waybill_phase: 'unloading',
      stops: [
        { id: 's1', kind: 'pickup',   stop_index: 0, loc: 'p', done_at: '2026-07-05T09:00:00', waybilled_at: '2026-07-04T12:00:00' },
        { id: 's2', kind: 'delivery', stop_index: 0, loc: 'q', done_at: '2026-07-05T14:00:00', waybilled_at: null }
      ]
    }];
    sb._selectedOrderIds = ['X'];
    sb.stateSave({ draft: { puncte: [{ tip: 'Plecare', loc: 'G', data: '2026-07-01' }] } });
    sb.wbLocDialog = (k, cb) => cb({ loc: 'G', date: '2026-07-05', time: '09:00' });
    let step2Called = false;
    sb.fuvarStep2 = () => { step2Called = true; };
    sb.fuvarCreate();
    expect((sb.stateGet() || {}).draft).toBeFalsy();
    expect(step2Called).toBe(true);
    // Csak a még nem waybill-ezett elvégzett delivery kerül be
    expect(sb._selectedOrderIds).toEqual(['X']);
    expect(sb._autoStopFilter.byOrder.X.s2).toBe(true);
    expect(sb._autoStopFilter.byOrder.X.s1).toBeUndefined(); // már waybill-ezve
    // Picker NEM nyílik meg fresh úton
    expect(sb.document.getElementById('orderPickerModal').style.display).not.toBe('flex');
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
//  Megerősítő modal (sofConfirm) — a natív confirm() helyett a
//  felület saját modalja kérdez a visszavonhatatlan műveleteknél.
//  Az „igen" ág CSAK a modal OK gombjára fut le.
// ================================================================
// ================================================================
//  driverMilestone — idő-picker modal (sofTimeConfirm). A régi
//  sofConfirm helyett a szerver `at` paramétert vár; a modal alap
//  értéke a MOSTANI idő, de a sofőr utólag pótolhatja. Az Igen
//  ág CSAK a sofTimeOk gomb után fut.
// ================================================================
describe('driverMilestone megerősítés (idő-picker modal)', () => {
  test('a hívás önmagában NEM küld — előbb megnyílik az idő-picker', () => {
    const urls = [];
    const sb = load({ fetch: (u) => { urls.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); } });
    sb.driverMilestone('ORD1', 0);
    expect(sb.document._registry.sofTimeModal.style.display).toBe('flex');
    expect(urls.filter(u => u.indexOf('/driver-milestone') >= 0)).toEqual([]);
  });

  test('Mégse → modal zárul, semmi nem megy ki', () => {
    const urls = [];
    const sb = load({ fetch: (u) => { urls.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); } });
    sb.driverMilestone('ORD1', 0);
    sb.sofTimeCancel();
    expect(sb.document._registry.sofTimeModal.style.display).toBe('none');
    expect(urls.filter(u => u.indexOf('/driver-milestone') >= 0)).toEqual([]);
  });

  test('Igen → POST a driver-milestone végpontra `at` ISO-val, modal zárul', async () => {
    const calls = [];
    const sb = load({ fetch: (u, o) => { calls.push({ u: String(u), m: o && o.method, body: o && o.body }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, step: 'loaded' }) }); } });
    sb.loadDashOrders = () => {};
    sb.driverMilestone('ORD1', 1);
    // A modal input értékét a valós kód a mostani helyi időre állította.
    // Az OK gomb ISO-ra konvertál és beteszi az `at`-ba.
    sb.sofTimeOk();
    await tick();
    const hit = calls.filter(c => c.u.indexOf('/driver-milestone') >= 0);
    expect(hit.length).toBe(1);
    expect(hit[0].m).toBe('POST');
    expect(hit[0].u).toContain('/api/orders/ORD1/driver-milestone');
    const body = JSON.parse(hit[0].body || '{}');
    expect(typeof body.at).toBe('string');
    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-formátum
    expect(sb.document._registry.sofTimeModal.style.display).toBe('none');
  });

  test('üres input → `at` nem kerül a body-ba (szerver NOW()-t használ)', async () => {
    const calls = [];
    const sb = load({ fetch: (u, o) => { calls.push({ u: String(u), body: o && o.body }); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); } });
    sb.loadDashOrders = () => {};
    sb.driverMilestone('ORD1', 1);
    // Töröljük az input-ot a jóváhagyás előtt (mint amikor a sofőr
    // szándékosan üresen hagyta) — a body-ban NEM lesz `at`.
    sb.document._registry.sofTimeInput.value = '';
    sb.sofTimeOk();
    await tick();
    const hit = calls.filter(c => c.u.indexOf('/driver-milestone') >= 0);
    expect(hit.length).toBe(1);
    const body = JSON.parse(hit[0].body || '{}');
    expect(body.at).toBeUndefined();
  });

  test('a modal címe a soron következő állomást nevezi meg', () => {
    const sb = load({});
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.driverMilestone('ORD1', 2);           // sosit_descarcare_at
    expect(sb.document._registry.sofTimeTitle.textContent).toBe('sof.ms.confirmTitle|sof.ms.arriveUnload');
  });

  test('érvénytelen/hiányzó stepIdx → általános kérdés, de továbbra is kérdez', () => {
    const sb = load({});
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.driverMilestone('ORD1');
    expect(sb.document._registry.sofTimeTitle.textContent).toBe('sof.ms.confirmTitle|sof.ms.recorded');
    sb.driverMilestone('ORD1', 99);
    expect(sb.document._registry.sofTimeTitle.textContent).toBe('sof.ms.confirmTitle|sof.ms.recorded');
  });
});

describe('sendBorderCross megerősítés (idő-picker modal)', () => {
  test('a hívás önmagában nem rögzít és GPS-t sem kér', () => {
    const urls = [];
    let geo = 0;
    const sb = load({ fetch: (u) => { urls.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); } });
    sb.navigator.geolocation = { getCurrentPosition: () => { geo++; } };
    sb.sendBorderCross('Iesire', 'RO');
    expect(sb.document._registry.sofTimeModal.style.display).toBe('flex');
    expect(urls.filter(u => u.indexOf('/api/border-cross') >= 0)).toEqual([]);
    expect(geo).toBe(0);
  });

  test('Igen → POST az /api/border-cross végpontra a helyes iránnyal + `at`', async () => {
    const calls = [];
    const sb = load({ fetch: (u, o) => { calls.push({ u: String(u), o }); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); } });
    sb.loadBorderLog = () => {};
    sb.sendBorderCross('Intrare', 'RO');
    sb.sofTimeOk();
    await tick();
    const hit = calls.filter(c => c.u.indexOf('/api/border-cross') >= 0);
    expect(hit.length).toBe(1);
    expect(hit[0].o.method).toBe('POST');
    const body = JSON.parse(hit[0].o.body);
    expect(body).toMatchObject({ tip: 'Intrare', tara: 'RO' });
    expect(typeof body.at).toBe('string');
    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('a modal címe az irányt nevezi meg (BE / KI külön)', () => {
    const sb = load({});
    sb.t = (k, v) => (v && v.act != null) ? (k + '|' + v.act) : k;
    sb.sendBorderCross('Intrare', 'RO');
    expect(sb.document._registry.sofTimeTitle.textContent).toBe('sof.crossConfirmTitle|sof.crossIn');
    sb.sofTimeCancel();
    sb.sendBorderCross('Iesire', 'RO');
    expect(sb.document._registry.sofTimeTitle.textContent).toBe('sof.crossConfirmTitle|sof.crossOut');
  });
});

// ================================================================
//  Fuvar-kártya: fázis-vezérelt fel-/lerakás + a megbízó neve sehol
// ================================================================
describe('renderFuvarCard fázis-logika', () => {
  const ORDER = {
    id: 'ORD9', status: 'In Curs',
    client: 'TITKOS MEGBIZO SRL',
    firma_incarcare: 'Alfa Depo', loc_incarcare: 'Arad',
    firma_descarcare: 'Beta Raktar', loc_descarcare: 'Budapest',
    data_incarcare: '2026-07-28', data_descarcare: '2026-07-30',
    rendszam_camion: 'B123XYZ'
  };
  const body = (html, kind) => {
    // a `fdbody_<kind>_<id>` div nyitva van-e (nincs rajta display:none)
    const m = html.match(new RegExp('id="fdbody_' + kind + '_ORD9"([^>]*)>'));
    return m ? !/display:none/.test(m[1]) : null;
  };

  test('felrakodás ELŐTT: a felrakás nyitva, a lerakó lecsukva (de lenyitható)', () => {
    const sb = load({});
    const html = sb.renderFuvarCard(ORDER, 1);
    expect(body(html, 'load')).toBe(true);
    expect(body(html, 'unload')).toBe(false);
    // sorrend: előbb a felrakás
    expect(html.indexOf('fdsec_load_ORD9')).toBeLessThan(html.indexOf('fdsec_unload_ORD9'));
    // a lecsukott szekció is kattintható (van rajta toggle + caret)
    expect(html).toContain("toggleFuvarSec('ORD9','unload')");
    expect(html).toContain('id="fdcar_unload_ORD9"');
  });

  test('felrakodás UTÁN: a lerakás nyitva és elöl, a felrakó lecsukva marad elérhető', () => {
    const sb = load({});
    const html = sb.renderFuvarCard(Object.assign({}, ORDER, { incarcat_at: '2026-07-28T09:10:00Z' }), 1);
    expect(body(html, 'unload')).toBe(true);
    expect(body(html, 'load')).toBe(false);
    expect(html.indexOf('fdsec_unload_ORD9')).toBeLessThan(html.indexOf('fdsec_load_ORD9'));
    expect(html).toContain("toggleFuvarSec('ORD9','load')");
  });

  test('a megbízó cég neve SEHOL nem jelenik meg a kártyán', () => {
    const sb = load({});
    const a = sb.renderFuvarCard(ORDER, 1);
    const b = sb.renderFuvarCard(Object.assign({}, ORDER, { incarcat_at: '2026-07-28T09:10:00Z' }), 2);
    expect(a).not.toContain('TITKOS MEGBIZO');
    expect(b).not.toContain('TITKOS MEGBIZO');
    // a fel-/lerakó cég viszont IGEN (az a sofőr munkája)
    expect(a).toContain('Alfa Depo');
    expect(a).toContain('Beta Raktar');
  });

  test('toggleFuvarSec ki-/becsukja a szekciót és állítja a lenyíló ikont', () => {
    const sb = load({});
    sb.renderFuvarCard(ORDER, 1);
    const reg = sb.document._registry;
    // A stub-DOM az első getElementById-ra hozza létre az elemet (a render
    // csak HTML-stringet ad vissza) — a szekció-elemeket előre „kikérjük".
    ['fdbody_unload_ORD9', 'fdcar_unload_ORD9', 'fdsec_unload_ORD9']
      .forEach(id => sb.document.getElementById(id));
    reg['fdbody_unload_ORD9'].style.display = 'none';       // csukott kiindulás
    sb.toggleFuvarSec('ORD9', 'unload');
    expect(reg['fdbody_unload_ORD9'].style.display).toBe('block');
    expect(reg['fdcar_unload_ORD9'].textContent).toBe('▾');
    expect(reg['fdsec_unload_ORD9'].classList.contains('open')).toBe(true);
    sb.toggleFuvarSec('ORD9', 'unload');
    expect(reg['fdbody_unload_ORD9'].style.display).toBe('none');
    expect(reg['fdcar_unload_ORD9'].textContent).toBe('▸');
    expect(reg['fdsec_unload_ORD9'].classList.contains('open')).toBe(false);
  });
});
