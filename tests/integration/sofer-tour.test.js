// ============================================================
//  Sofőr onboarding bemutató (public/sofer-tour.js) — smoke test.
//
//  A tour egy tisztán kliens-oldali IIFE: DOM overlay + spotlight +
//  tooltip + DEMO fuvar injektálás a `_soferOrdersCache`-be, valamint
//  `demoIntercept()` guard a valós fetch-eket eldobja bemutató alatt.
//  A projektben nincs jsdom — minimál DOM-stubot használunk (mint a
//  sofer-client-flow.test.js).
//
//  Fókusz:
//    - IIFE lefut hibamentesen, exportál API-t
//    - Perzisztencia (isDone / resetSeen)
//    - Demó fuvar injektálás → _soferOrdersCache-be kerül, kártya
//      DEMO-badge-et kap; stop → kikerül
//    - demoIntercept: aktív tour alatt border/waybill/doc/handover
//      → true; DEMO id-re akkor is true, ha nem fut a tour
//    - Kritikus akciók (driverStopAction, sendBorderCross,
//      submitFuvarlevel, uploadDoc, submitHandover, driverMilestone) a
//      sofer.js elején hívják a demoIntercept-et → nem küldenek.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOUR_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sofer-tour.js'), 'utf8');
const SOFER_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sofer.js'), 'utf8');

// ── In-memory localStorage ──
function makeStore() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear: () => { for (const k in m) delete m[k]; }
  };
}

// ── Minimál DOM: elég a tour engine számára (createElement, appendChild,
//    getElementById, querySelector*, style, classList, dataset, textContent,
//    innerHTML, appendChild, removeChild, getBoundingClientRect stub). ──
function makeDOM() {
  const registry = {};
  function newEl(tag) {
    const e = {
      tagName: (tag || 'div').toUpperCase(),
      id: '',
      style: {},
      dataset: {},
      attributes: {},
      _children: [],
      parentNode: null,
      className: '',
      textContent: '',
      innerHTML: '',
      offsetHeight: 200,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; }
      },
      appendChild(c) { c.parentNode = this; this._children.push(c); return c; },
      insertBefore(c, ref) {
        c.parentNode = this;
        const i = ref ? this._children.indexOf(ref) : -1;
        this._children.splice(i >= 0 ? i : this._children.length, 0, c);
        return c;
      },
      removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parentNode = null; return c; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; },
      addEventListener() {},
      removeEventListener() {},
      scrollIntoView() {},
      focus() {},
      querySelector(sel) { return this._querySelector(sel); },
      querySelectorAll(sel) { return this._querySelectorAll(sel); },
      _querySelector(sel) {
        const all = this._querySelectorAll(sel);
        return all.length ? all[0] : null;
      },
      _querySelectorAll(sel) {
        // Egyszerű: id (#x), class (.x), tag, attribute [x], data-tour-demo="1"
        const results = [];
        function walk(node) {
          for (const child of node._children || []) {
            if (matches(child, sel)) results.push(child);
            walk(child);
          }
        }
        walk(this);
        return results;
      },
      getBoundingClientRect() { return { top: 100, left: 50, width: 200, height: 60, right: 250, bottom: 160 }; },
      get firstChild() { return this._children[0] || null; }
    };
    return e;
  }
  function matches(el, sel) {
    sel = String(sel).trim();
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) {
      const cls = sel.slice(1).split(/[\s,.>]/)[0];
      return el.classList.contains(cls) || (el.className || '').split(/\s+/).includes(cls);
    }
    if (sel.startsWith('[data-')) {
      const m = sel.match(/^\[data-([^=\]]+)(?:="([^"]*)")?\]$/);
      if (m) {
        const key = m[1], val = m[2];
        const attr = el.attributes['data-' + key];
        if (val === undefined) return attr != null;
        return attr === val;
      }
    }
    // .kiosztott-section, .st-tip, .st-center etc. — csak class-match
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return el.classList.contains(cls);
    }
    return false;
  }

  const doc = {
    documentElement: newEl('html'),
    head: newEl('head'),
    body: newEl('body'),
    createElement: (tag) => newEl(tag),
    getElementById: (id) => {
      if (registry[id]) return registry[id];
      // walk body
      const stack = [doc.body];
      while (stack.length) {
        const n = stack.shift();
        if (n.id === id) return n;
        for (const c of n._children || []) stack.push(c);
      }
      return null;
    },
    querySelector: (sel) => doc.body._querySelector(sel),
    querySelectorAll: (sel) => doc.body._querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {},
    _register: (id, el) => { registry[id] = el; el.id = id; doc.body._children.push(el); el.parentNode = doc.body; }
  };
  return doc;
}

function bootWindow() {
  const localStorage = makeStore();
  const document = makeDOM();
  // Néhány valós elem, amikre a tour anchor()-jai várnak.
  const el = (tag, id, cls, onclick) => {
    const e = document.createElement(tag);
    e.id = id || '';
    if (cls) { e.className = cls; e.classList.add(cls.split(/\s+/)[0]); cls.split(/\s+/).slice(1).forEach(c => e.classList.add(c)); }
    if (onclick) e.attributes['onclick'] = onclick;
    return e;
  };
  const header = el('div', '', 'sofer-header'); document.body.appendChild(header);
  const dashSec = el('div', 'sec-dash', 'pane-sofer'); document.body.appendChild(dashSec);
  const kioSect = el('div', '', 'kiosztott-section'); dashSec.appendChild(kioSect);
  const kioList = el('div', 'kiosztottList'); kioSect.appendChild(kioList);
  const navBorder = el('div', '', 'sofer-nav-card', "goSec('border')"); dashSec.appendChild(navBorder);
  const navFuvar  = el('div', '', 'sofer-nav-card', "goSec('fuvar')"); dashSec.appendChild(navFuvar);
  const navDocs   = el('div', '', 'sofer-nav-card', "goSec('docs')"); dashSec.appendChild(navDocs);
  const navChat   = el('div', '', 'sofer-nav-card', 'openWhatsAppFromChatCard()'); dashSec.appendChild(navChat);
  const navTour   = el('div', 'soferTourNavCard', 'sofer-nav-card', 'SoferTour.start(true)'); dashSec.appendChild(navTour);
  const gdpr = el('div', 'gdprBanner'); gdpr.style.display = 'none'; document.body.appendChild(gdpr);
  const bugFab = el('button', 'bugFab'); document.body.appendChild(bugFab);
  const borderSec = el('div', 'sec-border', 'pane-sofer hidden'); document.body.appendChild(borderSec);
  const borderIn = el('button', '', 'border-btn in'); borderSec.appendChild(borderIn);
  const fuvarSec = el('div', 'sec-fuvar', 'pane-sofer hidden'); document.body.appendChild(fuvarSec);
  const fuvarCreate = el('button', ''); fuvarCreate.attributes['onclick'] = 'fuvarCreate()'; fuvarSec.appendChild(fuvarCreate);
  const scanBtn = el('button', 'fuvarStep1ScanBtn'); fuvarSec.appendChild(scanBtn);

  const window = {
    document,
    localStorage,
    innerWidth: 400,
    innerHeight: 800,
    _soferOrdersCache: [],
    _meData: { email: 'peto@teszt.ro' },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener: () => {},
    removeEventListener: () => {},
    onLangChange: null,
    // Toast — figyeljük.
    _lastToast: null,
    toast: (m, k) => { window._lastToast = { m, k }; },
    // t() — kulcsot visszaad.
    t: (k) => k,
    // Mock renderFuvarCard — reprodukálja a valós data-tour-demo markert.
    renderFuvarCard: (o, idx) => {
      const attrs = ' data-order-id="' + o.id + '"' + (o._isDemo ? ' data-tour-demo="1"' : '');
      const demoHead = o._isDemo ? '<div class="st-demo-badge">DEMO</div>' : '';
      return '<div class="fuvar-card"' + attrs + '>' + demoHead + '#' + idx + ' ' + (o.loc_incarcare || '') + ' → ' + (o.loc_descarcare || '') + '</div>';
    },
    goSec: () => {},
    console
  };
  window.window = window;
  document.defaultView = window;
  return window;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('SoferTour — sofőr onboarding bemutató', () => {
  test('IIFE lefut hibamentesen és exportálja a publikus API-t', () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    expect(typeof w.SoferTour).toBe('object');
    ['start', 'stop', 'isDone', 'resetSeen', 'demoIntercept', '_next', '_prev', '_reflow']
      .forEach(fn => expect(typeof w.SoferTour[fn]).toBe('function'));
  });

  test('isDone kezdetben false; resetSeen és markDone (stop finished) helyesen működik', () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    expect(w.SoferTour.isDone()).toBe(false);
    // stop(true) → jelöljük kész-nek (a stepIdx>2 vagy finished flag kell — most finished)
    w.SoferTour.stop(true);
    expect(w.SoferTour.isDone()).toBe(true);
    w.SoferTour.resetSeen();
    expect(w.SoferTour.isDone()).toBe(false);
  });

  test('start() → welcome center-modal a body-hoz csatolva, tartalmazza a welcome kulcsot', async () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    w.SoferTour.start(true);
    await wait(120);
    // A welcome egy `<div class="st-center">` a body-hoz appendezve; a
    // belső card innerHTML-string, ezt szövegként ellenőrizzük.
    const center = w.document.querySelector('.st-center');
    expect(center).toBeTruthy();
    // Az `t()` mock kulcsot ad vissza (`k => k`), tehát a tour T() helper
    // fallback-et használ (magyar def-szöveg). A welcome szövegben ott
    // van a „VallorSoft" márkanév és a „Kezdés" cselekvés.
    expect(center.innerHTML).toMatch(/VallorSoft/);
    expect(center.innerHTML).toMatch(/Kezdés/);
  });

  test('_next() a 2. lépésre lép → DEMO fuvar bekerül a cache-be és rendereli', async () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    w.SoferTour.start(true);
    await wait(120);
    // welcome → topbar
    w.SoferTour._next();
    await wait(120);
    // topbar → orders (ez injektálja a DEMO-t)
    w.SoferTour._next();
    await wait(120);
    const demo = w._soferOrdersCache.find(o => o.id === 'CMD-DEMO-001');
    expect(demo).toBeTruthy();
    expect(demo._isDemo).toBe(true);
    expect(demo.rendszam_camion).toBe('DEMO-01');
    expect(Array.isArray(demo.stops) && demo.stops.length).toBe(2);
    // A kártya kirenderelődött és megkapta a data-tour-demo markert.
    const list = w.document.getElementById('kiosztottList');
    expect(list.innerHTML).toMatch(/data-tour-demo="1"/);
    expect(list.innerHTML).toMatch(/CMD-DEMO-001/);
  });

  test('stop() eltávolítja a DEMO fuvart és a tour DOM-ot', async () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    w.SoferTour.start(true);
    await wait(100);
    w.SoferTour._next(); await wait(80);
    w.SoferTour._next(); await wait(80);
    expect(w._soferOrdersCache.find(o => o.id === 'CMD-DEMO-001')).toBeTruthy();
    w.SoferTour.stop(true);
    expect(w._soferOrdersCache.find(o => o.id === 'CMD-DEMO-001')).toBeUndefined();
    expect(w.SoferTour.isDone()).toBe(true);
  });

  test('demoIntercept aktív tour alatt: border/waybill/doc/handover → true, egyéb → false', () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    w.SoferTour.start(true);
    expect(w.SoferTour.demoIntercept('border',   'RO BE')).toBe(true);
    expect(w.SoferTour.demoIntercept('waybill',  'submit')).toBe(true);
    expect(w.SoferTour.demoIntercept('doc',      'upload')).toBe(true);
    expect(w.SoferTour.demoIntercept('handover', 'áru')).toBe(true);
    expect(w.SoferTour.demoIntercept('CMD-DEMO-001', 'valódi demo')).toBe(true);
    expect(w.SoferTour.demoIntercept('CMD-REAL-123', 'valódi fuvar')).toBe(false);
    w.SoferTour.stop();
  });

  test('demoIntercept tour NÉLKÜL: DEMO id-re továbbra is true (védőháló), valós id-re false', () => {
    const w = bootWindow();
    const ctx = vm.createContext(w);
    vm.runInContext(TOUR_SRC, ctx);
    // Tour nem fut.
    expect(w.SoferTour.demoIntercept('CMD-DEMO-001', 'x')).toBe(true);
    expect(w.SoferTour.demoIntercept('CMD-REAL-999', 'x')).toBe(false);
    expect(w.SoferTour.demoIntercept('border',       'x')).toBe(false);
  });

  test('a sofer.js kritikus akciói meghívják a demoIntercept-et (statikus szöveg-ellenőrzés)', () => {
    // Regresszió-védelem: ha egy jövőbeli refaktor kiszedné az interceptet
    // valamelyik útból, ez a teszt megfog.
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\(orderId,\s*'Állomás-léptetés'\)/);
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\('border',/);
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\('waybill',/);
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\('doc',/);
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\('handover',/);
    expect(SOFER_SRC).toMatch(/SoferTour\.demoIntercept\(id,\s*'Állomás-léptetés \(legacy\)'\)/);
  });

  test('a renderFuvarCard demó fuvarra hozzáteszi a data-tour-demo markert és a badge-t', () => {
    // Regresszió-védelem: a tour a `[data-tour-demo="1"]` szelektorra vár —
    // ha a wrapper attribútum eltűnne, a bemutató elveszti a horgonyt.
    expect(SOFER_SRC).toMatch(/data-tour-demo="1"/);
    expect(SOFER_SRC).toMatch(/st-demo-badge/);
  });

  test('az első belépés auto-start ága bent van a sofer.js-ben', () => {
    // Regresszió-védelem: az authMe-után SoferTour.start(true) blokk.
    expect(SOFER_SRC).toMatch(/if\s*\(!SoferTour\.isDone\(\)\)\s*SoferTour\.start\(true\)/);
  });
});
