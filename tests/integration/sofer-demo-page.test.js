// ============================================================
//  Sofőr DEMÓ oldal (/sofer-demo) — web-smoke + inline JS boot.
//
//  A /sofer-demo egy önálló, standalone sandbox oldal — a valós
//  felülettel identikus stílusú, saját state-tel, semmi nem megy
//  a szerverre. Ez a teszt biztosítja, hogy:
//    - a route auth mögött van (Sofer/Admin/Manager)
//    - az oldal HTML-je 12 wizard-lépést tartalmaz
//    - a mock felület állapotgépe hibamentesen bootol (VM-ben)
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sofer-demo.html'), 'utf8');
const PAGES_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'pages.js'), 'utf8');

describe('/sofer-demo — sofőr DEMÓ sandbox oldal', () => {
  test('a route regisztrálva van a routes/pages.js-ben', () => {
    expect(PAGES_SRC).toMatch(/router\.get\('\/sofer-demo'/);
    // Ugyanaz a szerep-védelem mint a /sofer-en.
    expect(PAGES_SRC).toMatch(/'\/sofer-demo'[\s\S]{0,200}requirePageRole\('Sofer', 'Admin', 'Manager'\)/);
  });

  test('a HTML fájl létezik és tartalmazza a fő struktúrát', () => {
    expect(HTML_SRC.length).toBeGreaterThan(5000);
    expect(HTML_SRC).toMatch(/DEMÓ|DEMO/);
    // Fő elemek
    expect(HTML_SRC).toMatch(/id="pScreen"/);
    expect(HTML_SRC).toMatch(/data-scene="dash"/);
    expect(HTML_SRC).toMatch(/data-scene="border"/);
    expect(HTML_SRC).toMatch(/data-scene="waybill"/);
    expect(HTML_SRC).toMatch(/data-scene="docs"/);
    expect(HTML_SRC).toMatch(/data-scene="chat"/);
    // Wizard nav
    expect(HTML_SRC).toMatch(/id="gStepNum"/);
    expect(HTML_SRC).toMatch(/id="gBar"/);
    expect(HTML_SRC).toMatch(/onclick="guideNext\(\)"/);
    // Kilépés — visszatér a valós /sofer-re
    expect(HTML_SRC).toMatch(/window\.location\.href\s*=\s*'\/sofer'/);
  });

  test('a 12 wizard-lépés (STEPS) mind definiálva van', () => {
    // A STEPS tömb 12 elemű, minden lépéshez tartozik title/body/hint kulcs.
    for (var i = 0; i < 12; i++) {
      expect(HTML_SRC).toMatch(new RegExp('dm\\.g\\.s' + i + '\\.title'));
      expect(HTML_SRC).toMatch(new RegExp('dm\\.g\\.s' + i + '\\.body'));
    }
    // Interakciós scene-ek (waitAction jelöltek): openCard, stopBtn, borderTap, waybillCreate
    expect(HTML_SRC).toMatch(/waitAction:\s*true/);
  });

  test('az inline JS syntax-tiszta és a mock függvények elérhetők a globális scope-ban', () => {
    // Extract inline script blocks (>0 length, skip external)
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(HTML_SRC)) !== null) {
      if (m[1].trim().length > 0) scripts.push(m[1]);
    }
    expect(scripts.length).toBeGreaterThan(0);
    // Az összes inline script összefűzve kell szintaxis-tiszta legyen
    const src = scripts.join('\n');
    expect(() => new vm.Script(src)).not.toThrow();
    // Kulcsfüggvények, amiket explicit `window.X = X` néven exportálunk
    // (inline onclick handlerek hívják). A `mockToast` belső segéd —
    // a globális function-declaration miatt eleve elérhető inline
    // handlerekből, nem szükséges explicit window-export.
    ['guideNext', 'guidePrev', 'exitDemo', 'mockToggleCard', 'mockStopStep',
     'mockBorderTap', 'mockWbCreate', 'mockNavToScene']
      .forEach(fn => expect(src).toContain('window.' + fn + ' = ' + fn));
  });

  test('a scene-váltás és a mock állomás-léptetés hibamentesen fut VM-ben', () => {
    // Extract inline JS
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    const scripts = [];
    let m;
    while ((m = re.exec(HTML_SRC)) !== null) {
      if (m[1].trim().length > 0) scripts.push(m[1]);
    }
    const src = scripts.join('\n');

    // Minimál DOM-shim (a script `document.getElementById`-t, `querySelectorAll`-t hív)
    const elMap = {};
    const makeEl = () => ({
      style: {}, dataset: {}, attributes: {}, _children: [],
      classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,on){if(on===undefined)on=!this._s.has(c);on?this._s.add(c):this._s.delete(c);return on;}, contains(c){return this._s.has(c);} },
      innerHTML: '', textContent: '', value: '',
      appendChild(c){ this._children.push(c); return c; },
      setAttribute(k,v){ this.attributes[k]=String(v); },
      getAttribute(k){ return this.attributes[k]||null; },
      addEventListener(){}, removeEventListener(){}
    });
    ['mockToast', 'mockFuvarCard', 'mockStops', 'mockStopBtn', 'mockBorderList',
     'mockWbStep1', 'mockWbStep2', 'mockPtr', 'pMeBadge', 'pScreen',
     'gStepNum', 'gBar', 'gStepTag', 'gTitle', 'gBody', 'gHint', 'gPrev', 'gNext']
      .forEach(id => elMap[id] = makeEl());

    const ctx = {
      window: {},
      document: {
        readyState: 'loaded',
        getElementById: (id) => elMap[id] || null,
        querySelectorAll: (sel) => {
          // csak a `.p-section` szelektorra van szükségünk (mockNavToScene)
          if (sel === '.p-section') {
            return ['dash', 'border', 'waybill', 'docs', 'chat'].map(name => {
              const e = makeEl();
              e.getAttribute = (k) => k === 'data-scene' ? name : null;
              return e;
            });
          }
          return [];
        },
        addEventListener(){}
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      Date: Date,
      Math: Math,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      console: console
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    expect(() => vm.runInContext(src, ctx)).not.toThrow();

    // Boot után a globális állapotgép működik
    expect(typeof ctx.guideNext).toBe('function');
    expect(typeof ctx.mockStopStep).toBe('function');
    expect(typeof ctx.mockBorderTap).toBe('function');
    expect(typeof ctx.mockWbCreate).toBe('function');

    // Lépteti a wizard-ot
    expect(() => ctx.guideNext()).not.toThrow();
    expect(() => ctx.mockNavToScene('border')).not.toThrow();
    expect(() => ctx.mockBorderTap('in')).not.toThrow();
    expect(() => ctx.mockStopStep()).not.toThrow();
    expect(() => ctx.mockWbCreate()).not.toThrow();
    expect(() => ctx.mockToast('teszt')).not.toThrow();
  });
});
