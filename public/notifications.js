/* notifications.js — Értesítési központ kliens-modul.
 * - Felső sáv 🔔 csengő + lenyíló panel (legutóbbi értesítések, olvasott jelölés).
 * - Teljes Értesítések oldal (Adminisztráció → notifications).
 * Backend RPC-k: notifList, notifUnreadCount, notifMarkRead, notifMarkAllRead.
 * Csak megjelenítés — a `gas()` és `t()` a console-shared.js-ből.
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function T(k) { return (typeof t === 'function') ? t(k) : k; }

  // Relatív idő (egyszerű, nyelvfüggetlen formátum).
  function ago(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return d.toLocaleDateString();
  }

  function rowHtml(n) {
    var unread = !n.read_at;
    return '<div class="vs-notif-item' + (unread ? ' unread' : '') + '" data-id="' + Number(n.id) + '"'
      + (n.link_tab ? ' data-tab="' + esc(n.link_tab) + '"' : '') + '>'
      + '<div class="vs-notif-dot"></div>'
      + '<div class="vs-notif-main">'
      + '<div class="vs-notif-title">' + esc(n.title || '') + '</div>'
      + (n.body ? '<div class="vs-notif-body">' + esc(n.body) + '</div>' : '')
      + '<div class="vs-notif-time">' + esc(ago(n.created_at)) + '</div>'
      + '</div></div>';
  }

  // ── Felső sáv csengő + panel ────────────────────────────────
  function refreshBadge() {
    if (!window.gas) return;
    gas('notifUnreadCount', []).then(function (r) {
      var dot = document.getElementById('vsBellDot');
      if (!dot) return;
      var c = (r && r.ok) ? (r.count || 0) : 0;
      if (c > 0) { dot.textContent = c > 99 ? '99+' : String(c); dot.style.display = ''; }
      else dot.style.display = 'none';
    }).catch(function () {});
  }

  function renderPanel() {
    var list = document.getElementById('vsBellList');
    if (!list) return;
    list.innerHTML = '<div class="vs-notif-empty">…</div>';
    gas('notifList', []).then(function (r) {
      var items = (r && r.ok) ? (r.items || []) : [];
      if (!items.length) { list.innerHTML = '<div class="vs-notif-empty">' + esc(T('notif.empty')) + '</div>'; return; }
      list.innerHTML = items.slice(0, 12).map(rowHtml).join('');
    }).catch(function () {
      list.innerHTML = '<div class="vs-notif-empty">' + esc(T('notif.empty')) + '</div>';
    });
  }

  function togglePanel(forceOpen) {
    var pop = document.getElementById('vsBellPop');
    if (!pop) return;
    var open = forceOpen != null ? forceOpen : (pop.style.display === 'none' || !pop.style.display);
    pop.style.display = open ? 'block' : 'none';
    if (open) {
      // A felső sáv NEM a .main-content alatt van → a téma-osztályt itt visszük át.
      var mc = document.getElementById('mainContent');
      var dark = mc && mc.getAttribute('data-theme') === 'dark';
      pop.classList.toggle('dark', !!dark);
      renderPanel();
    }
  }

  function onItemClick(el) {
    var id = parseInt(el.getAttribute('data-id'), 10);
    var tab = el.getAttribute('data-tab');
    if (id) gas('notifMarkRead', [{ id: id }]).then(refreshBadge).catch(function () {});
    togglePanel(false);
    if (tab && typeof activateTab === 'function') activateTab(tab);
  }

  // A csengőt a felső sáv jobb oldalába injektáljuk (a nyelv/téma elé).
  function mountBell() {
    var right = document.querySelector('.vs-topbar .vs-tb-right');
    if (!right || document.getElementById('vsBellBtn')) return;
    var wrap = document.createElement('div');
    wrap.className = 'vs-bell-wrap';
    wrap.innerHTML =
      '<button type="button" class="vs-bell-btn" id="vsBellBtn" aria-label="' + esc(T('notif.panelTitle')) + '" title="' + esc(T('notif.panelTitle')) + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      + '<span class="vs-bell-dot" id="vsBellDot" style="display:none;"></span>'
      + '</button>'
      + '<div class="vs-bell-pop" id="vsBellPop" style="display:none;">'
      + '<div class="vs-bell-head"><span>' + esc(T('notif.panelTitle')) + '</span>'
      + '<button type="button" class="vs-bell-allbtn" id="vsBellAll">' + esc(T('notif.markAll')) + '</button></div>'
      + '<div class="vs-notif-list" id="vsBellList"></div>'
      + '<div class="vs-bell-foot"><a href="#" id="vsBellViewAll">' + esc(T('notif.viewAll')) + '</a></div>'
      + '</div>';
    right.insertBefore(wrap, right.firstChild);

    document.getElementById('vsBellBtn').addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
    document.getElementById('vsBellAll').addEventListener('click', function (e) {
      e.stopPropagation();
      gas('notifMarkAllRead', []).then(function () { refreshBadge(); renderPanel(); }).catch(function () {});
    });
    document.getElementById('vsBellViewAll').addEventListener('click', function (e) {
      e.preventDefault(); togglePanel(false);
      if (typeof activateTab === 'function') activateTab('notifications');
    });
    document.getElementById('vsBellList').addEventListener('click', function (e) {
      var it = e.target.closest && e.target.closest('.vs-notif-item');
      if (it) onItemClick(it);
    });
    // Kívülre kattintásra zár
    document.addEventListener('click', function (e) {
      var pop = document.getElementById('vsBellPop');
      if (pop && pop.style.display === 'block' && !wrap.contains(e.target)) togglePanel(false);
    });

    refreshBadge();
    setInterval(refreshBadge, 60 * 1000);
  }

  // ── Teljes Értesítések oldal ────────────────────────────────
  function loadPage() {
    var box = document.getElementById('notifPageBox');
    if (!box) return;
    box.innerHTML = '<div class="vs-notif-empty">…</div>';
    gas('notifList', []).then(function (r) {
      var items = (r && r.ok) ? (r.items || []) : [];
      if (!items.length) { box.innerHTML = '<div class="vs-notif-empty">' + esc(T('notif.empty')) + '</div>'; return; }
      box.innerHTML = items.map(rowHtml).join('');
    }).catch(function () {
      box.innerHTML = '<div class="vs-notif-empty">' + esc(T('notif.empty')) + '</div>';
    });
  }

  window.NotifPageMarkAll = function () {
    gas('notifMarkAllRead', []).then(function () { loadPage(); refreshBadge(); }).catch(function () {});
  };
  // A page-listán kattintás → olvasott + (ha van) fülre ugrik
  document.addEventListener('click', function (e) {
    var box = document.getElementById('notifPageBox');
    if (!box) return;
    var it = e.target.closest && e.target.closest('#notifPageBox .vs-notif-item');
    if (!it) return;
    var id = parseInt(it.getAttribute('data-id'), 10);
    var tab = it.getAttribute('data-tab');
    if (id) gas('notifMarkRead', [{ id: id }]).then(function () { refreshBadge(); loadPage(); }).catch(function () {});
    if (tab && typeof activateTab === 'function') activateTab(tab);
  });

  window.Notifications = { mountBell: mountBell, loadPage: loadPage, refreshBadge: refreshBadge };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBell);
  else mountBell();
})();
