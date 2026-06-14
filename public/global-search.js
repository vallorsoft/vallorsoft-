// public/global-search.js — Globális kereső (command palette) a fix felső sávhoz.
// Ctrl/Cmd+K nyitja; keres a MENÜPONTOKBAN (navigáció) és ÉLŐ ADATBAN
// (fuvarok/ügyfelek/járművek/sofőrök — a `globalSearch` RPC-n át, company_id-szűrve).
// Találatra: a megfelelő fülre ugrik (activateTab) vagy oldalra navigál.
// Funkció-független kiegészítő réteg; a meglévő gas()/activateTab()-ot használja.
window.VSSearch = (function () {
  var back, input, results, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); };
  var items = [];      // aktuális lapos találat-lista (a billentyű-navigációhoz)
  var active = -1;     // kiemelt találat indexe
  var timer = null, lastQ = '';

  var SVG_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var SVG_NAV = '<svg class="vs-cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var SVG_DOT = '<svg class="vs-cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

  function ensure() {
    if (back) return;
    back = document.createElement('div');
    back.className = 'vs-cmdk-back';
    back.innerHTML =
      '<div class="vs-cmdk" role="dialog" aria-modal="true">' +
        '<div class="vs-cmdk-top">' + SVG_SEARCH +
          '<input class="vs-cmdk-input" id="vsCmdkInput" type="text" autocomplete="off" spellcheck="false" placeholder="Keresés: menü, fuvar, ügyfél, jármű, sofőr…">' +
          '<span class="vs-cmdk-esc">ESC</span>' +
        '</div>' +
        '<div class="vs-cmdk-results" id="vsCmdkResults"></div>' +
      '</div>';
    document.body.appendChild(back);
    input = back.querySelector('#vsCmdkInput');
    results = back.querySelector('#vsCmdkResults');
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    input.addEventListener('input', function () { schedule(input.value); });
    input.addEventListener('keydown', onKey);
  }

  // A sidebar menüpontjai (data-tab + link) — a navigációs találatokhoz
  function menuItems() {
    var out = [];
    document.querySelectorAll('.sidebar [data-tab], .sidebar a.tab-link').forEach(function (el) {
      if (el.classList.contains('nav-head')) return;            // a lenyíló fejléc nem cél
      if (el.offsetParent === null && el.style.display === 'none') return; // rejtett (feature-flag)
      var span = el.querySelector('span');
      var label = (span ? span.textContent : el.textContent || '').trim();
      if (!label) return;
      out.push({ label: label, tab: el.getAttribute('data-tab'), href: el.getAttribute('href') || null });
    });
    return out;
  }

  function schedule(q) {
    q = (q || '').trim();
    if (timer) clearTimeout(timer);
    // a menü-szűrés azonnal; az adat-keresés debounce-olva
    renderMenu(q);
    if (q.length < 2) { lastQ = q; return; }
    timer = setTimeout(function () { runData(q); }, 200);
  }

  var menuHtml = '';
  function renderMenu(q) {
    var ql = q.toLowerCase();
    var mi = menuItems().filter(function (m) { return !q || m.label.toLowerCase().indexOf(ql) >= 0; });
    if (q && mi.length === 0) { menuHtml = ''; }
    else {
      menuHtml = '<div class="vs-cmdk-group-t">Navigáció</div>' +
        mi.slice(0, 8).map(function (m) {
          return '<div class="vs-cmdk-item" data-kind="menu" data-tab="' + esc(m.tab || '') + '" data-href="' + esc(m.href || '') + '">' +
            SVG_NAV + '<div class="vs-cmdk-tx"><div class="vs-cmdk-tt">' + esc(m.label) + '</div></div></div>';
        }).join('');
    }
    paint(menuHtml + (q.length >= 2 ? '<div class="vs-cmdk-group-t" id="vsDataLoading">Keresés…</div>' : ''));
  }

  function runData(q) {
    lastQ = q;
    if (!window.gas) { return; }
    gas('globalSearch', [q]).then(function (r) {
      if (q !== lastQ) return;   // elavult válasz
      var html = '';
      if (r && r.ok && r.groups && r.groups.length) {
        html = r.groups.map(function (g) {
          return '<div class="vs-cmdk-group-t">' + esc(g.label) + '</div>' +
            (g.items || []).map(function (it) {
              return '<div class="vs-cmdk-item" data-kind="data" data-tab="' + esc(it.tab || '') + '">' +
                SVG_DOT + '<div class="vs-cmdk-tx"><div class="vs-cmdk-tt">' + esc(it.title) + '</div>' +
                (it.subtitle ? '<div class="vs-cmdk-st">' + esc(it.subtitle) + '</div>' : '') + '</div></div>';
            }).join('');
        }).join('');
      }
      var combined = menuHtml + html;
      if (!combined) combined = '<div class="vs-cmdk-empty">Nincs találat erre: „' + esc(q) + '”</div>';
      paint(combined);
    }).catch(function () { /* hálózati hiba — a menü-találatok maradnak */ });
  }

  function paint(html) {
    results.innerHTML = html || '<div class="vs-cmdk-empty">Kezdj el gépelni…</div>';
    items = Array.prototype.slice.call(results.querySelectorAll('.vs-cmdk-item'));
    active = items.length ? 0 : -1;
    highlight();
    items.forEach(function (el, i) {
      el.addEventListener('mouseenter', function () { active = i; highlight(); });
      el.addEventListener('click', function () { go(el); });
    });
  }
  function highlight() {
    items.forEach(function (el, i) { el.classList.toggle('active', i === active); });
    if (active >= 0 && items[active]) items[active].scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; highlight(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; highlight(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && items[active]) go(items[active]); }
  }
  function go(el) {
    var tab = el.getAttribute('data-tab'), href = el.getAttribute('data-href');
    close();
    if (href) { window.location.href = href; return; }
    if (tab && typeof activateTab === 'function') activateTab(tab);
  }

  function open() {
    ensure();
    back.classList.add('open');
    input.value = ''; renderMenu('');
    setTimeout(function () { input.focus(); }, 30);
  }
  function close() { if (back) back.classList.remove('open'); }

  // Ctrl/Cmd+K globális gyorsbillentyű
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
  });

  return { open: open, close: close };
})();
