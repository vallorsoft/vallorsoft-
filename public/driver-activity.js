// ============================================================
//  VallorSoft — driver-activity.js  (🎬 Sofőr-aktivitás)
//  2-oszlopos elrendezés (admin + manager konzol):
//    BAL: sofőr-kártya lista (avatar, KPI, utolsó aktivitás)
//    JOBB: kiválasztott sofőr — fejléc + fuvar-választó + időszak
//          + kronológikus timeline + fotó-galéria (lightbox)
//  A backend: handlers/driverActivity.js
//  Betöltés: console-shared.js UTÁN. Publikus API: window.DriverActivity
// ============================================================
(function () {
  'use strict';

  var _drivers = [];       // az áttekintő rács adata
  var _selectedEmail = null;
  var _selectedOrder = '';
  var _range = null;       // {from, to}
  var _search = '';        // keresés a bal-oszlopban
  var _typeFilter = null;  // esemény-típus szűrő a jobb-oszlopban

  function _range_default() {
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), 1);
    var to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    return { from: iso(from), to: iso(to) };
  }
  function _fmtDate(x) { return x ? new Date(x).toLocaleDateString('ro-RO') : '—'; }
  function _fmtDateTime(x) {
    if (!x) return '—';
    var d = new Date(x);
    return d.toLocaleDateString('ro-RO') + ' ' +
      d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  }
  function _n(x) {
    var n = parseFloat(x); if (!isFinite(n)) return '0';
    return n.toLocaleString('ro-RO', { maximumFractionDigits: 0 });
  }
  function _avatarHtml(name) {
    // Két első betűs monogram + hash-alapú determinisztikus szín (mint a stats-v2 pages/people)
    var s = String(name || '?').trim();
    var parts = s.split(/\s+/);
    var mono = (parts[0] || '?').charAt(0);
    if (parts[1]) mono += parts[1].charAt(0);
    mono = mono.toUpperCase();
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    var hue = h % 360;
    return '<span class="da-avatar" style="background:hsl(' + hue + ',60%,45%);">' +
      esc(mono) + '</span>';
  }
  function _relTime(x) {
    if (!x) return '';
    var d = new Date(x).getTime();
    var diff = Date.now() - d;
    if (!isFinite(diff)) return '';
    var days = Math.floor(diff / (24 * 3600 * 1000));
    if (days <= 0) return t('da.today');
    if (days === 1) return t('da.yesterday');
    if (days < 30) return t('da.daysAgo', { n: days });
    var months = Math.floor(days / 30);
    return t('da.monthsAgo', { n: months });
  }

  // ═════════════════════════════════════════════
  //  BELÉPÉSI PONT — a loadTab('sofer-activity') hívja
  // ═════════════════════════════════════════════
  function mount(boxId) {
    var box = document.getElementById(boxId || 'driverActivityBox');
    if (!box) return;
    if (!_range) _range = _range_default();
    box.innerHTML =
      '<div class="glass" style="padding:22px 22px 14px;">'
      +  '<div class="da-header">'
      +    '<div>'
      +      '<h2 class="h-title" style="margin:0;">🎬 ' + t('nav.driverActivity') + '</h2>'
      +      '<div class="h-sub">' + t('da.sub') + '</div>'
      +    '</div>'
      +    '<div class="da-range">'
      +      '<div class="field" style="margin:0;">'
      +        '<label>' + t('da.rangeFrom') + '</label>'
      +        '<input class="input" id="daFrom" type="date" value="' + _range.from + '" onchange="DriverActivity.onRangeChange()">'
      +      '</div>'
      +      '<div class="field" style="margin:0;">'
      +        '<label>' + t('da.rangeTo') + '</label>'
      +        '<input class="input" id="daTo" type="date" value="' + _range.to + '" onchange="DriverActivity.onRangeChange()">'
      +      '</div>'
      +      '<button class="btn ghost" onclick="DriverActivity.applyPreset(\'m\')" title="' + t('da.thisMonth') + '">📅 ' + t('da.thisMonth') + '</button>'
      +      '<button class="btn ghost" onclick="DriverActivity.applyPreset(\'w\')" title="' + t('da.thisWeek') + '">📆 ' + t('da.thisWeek') + '</button>'
      +    '</div>'
      +  '</div>'
      + '</div>'
      + '<div class="da-grid">'
      +   '<div class="da-left"  id="daLeft"><div class="text-muted" style="padding:24px;text-align:center;">' + t('da.loading') + '</div></div>'
      +   '<div class="da-right" id="daRight"><div class="da-empty">' + t('da.emptyRight') + '</div></div>'
      + '</div>';
    _loadDrivers();
  }

  function applyPreset(kind) {
    var now = new Date();
    var from, to;
    if (kind === 'w') {
      // hét kezdete (hétfő)
      var day = now.getDay(); if (day === 0) day = 7;
      from = new Date(now); from.setDate(now.getDate() - (day - 1));
      to = new Date(from); to.setDate(from.getDate() + 6);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    _range = { from: iso(from), to: iso(to) };
    document.getElementById('daFrom').value = _range.from;
    document.getElementById('daTo').value = _range.to;
    _loadDrivers();
    if (_selectedEmail) _loadDriverDetail();
  }

  function onRangeChange() {
    _range = {
      from: (document.getElementById('daFrom') || {}).value || _range_default().from,
      to:   (document.getElementById('daTo')   || {}).value || _range_default().to,
    };
    _loadDrivers();
    if (_selectedEmail) _loadDriverDetail();
  }

  // ═════════════════════════════════════════════
  //  BAL OSZLOP — sofőr-kártyák
  // ═════════════════════════════════════════════
  function _loadDrivers() {
    var left = document.getElementById('daLeft');
    if (!left) return;
    left.innerHTML = '<div class="text-muted" style="padding:24px;text-align:center;">' + t('da.loading') + '</div>';
    gas('getActivityDrivers', [{ from: _range.from, to: _range.to }]).then(function (r) {
      if (!r || !r.ok) {
        left.innerHTML = '<div class="text-muted" style="padding:24px;text-align:center;">'
          + esc((r && r.err) || t('common.error')) + '</div>';
        return;
      }
      _drivers = r.items || [];
      _renderDrivers();
    });
  }

  function _renderDrivers() {
    var left = document.getElementById('daLeft');
    if (!left) return;
    var q = String(_search || '').toLowerCase().trim();
    var filtered = q ? _drivers.filter(function (d) {
      return (d.nume || '').toLowerCase().indexOf(q) !== -1 ||
             (d.email || '').toLowerCase().indexOf(q) !== -1;
    }) : _drivers;

    // Rendezés: van-e aktivitás az időszakban? első helyre a legfrissebbek.
    filtered.sort(function (a, b) {
      var ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
      var tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
      return tb - ta;
    });

    var search =
      '<div class="da-search-wrap">'
      + '<input class="input da-search" placeholder="' + t('da.searchDriver') + '" '
      +   'value="' + esc(_search || '') + '" oninput="DriverActivity.onSearch(this.value)">'
      + '<div class="text-muted da-count">' + t('da.driverCount', { n: filtered.length }) + '</div>'
      + '</div>';

    if (!filtered.length) {
      left.innerHTML = search + '<div class="da-empty">' + t('da.noDrivers') + '</div>';
      return;
    }

    var cards = filtered.map(function (d) {
      var isActive = _selectedEmail === d.email;
      var last = d.last_activity_at
        ? '<span class="da-last" title="' + esc(_fmtDateTime(d.last_activity_at)) + '">🕐 ' + esc(_relTime(d.last_activity_at)) + '</span>'
        : '<span class="da-last da-none">' + t('da.noActivity') + '</span>';
      return '<div class="da-driver-card ' + (isActive ? 'is-active' : '') + '" '
        +   'onclick="DriverActivity.pickDriver(\'' + esc(d.email).replace(/'/g, '&#39;') + '\')">'
        + '<div class="da-driver-head">'
        +   _avatarHtml(d.nume || d.email)
        +   '<div class="da-driver-name">'
        +     '<div class="da-driver-nume">' + esc(d.nume || d.email) + '</div>'
        +     '<div class="da-driver-email">' + esc(d.email) + '</div>'
        +   '</div>'
        + '</div>'
        + '<div class="da-driver-kpis">'
        +   '<div class="da-kpi"><span class="da-kpi-v">' + _n(d.order_count) + '</span><span class="da-kpi-l">' + t('da.kpi.orders') + '</span></div>'
        +   '<div class="da-kpi"><span class="da-kpi-v">' + _n(d.waybill_count) + '</span><span class="da-kpi-l">' + t('da.kpi.waybills') + '</span></div>'
        +   '<div class="da-kpi"><span class="da-kpi-v">' + _n(d.km) + '</span><span class="da-kpi-l">' + t('da.kpi.km') + '</span></div>'
        +   '<div class="da-kpi"><span class="da-kpi-v">' + _n(d.photo_count) + '</span><span class="da-kpi-l">' + t('da.kpi.photos') + '</span></div>'
        + '</div>'
        + '<div class="da-driver-foot">' + last + '</div>'
        + '</div>';
    }).join('');

    left.innerHTML = search + '<div class="da-driver-list">' + cards + '</div>';
  }

  function onSearch(v) { _search = v || ''; _renderDrivers(); }

  function pickDriver(email) {
    _selectedEmail = email;
    _selectedOrder = '';
    _typeFilter = null;
    _renderDrivers();
    _loadDriverDetail();
  }

  // ═════════════════════════════════════════════
  //  JOBB OSZLOP — kiválasztott sofőr aktivitása
  // ═════════════════════════════════════════════
  function _loadDriverDetail() {
    var right = document.getElementById('daRight');
    if (!right) return;
    if (!_selectedEmail) {
      right.innerHTML = '<div class="da-empty">' + t('da.emptyRight') + '</div>';
      return;
    }
    right.innerHTML = '<div class="text-muted" style="padding:24px;text-align:center;">' + t('da.loading') + '</div>';
    var payload = { email: _selectedEmail, from: _range.from, to: _range.to };
    if (_selectedOrder) payload.orderId = _selectedOrder;
    gas('getDriverActivity', [payload]).then(function (r) {
      if (!r || !r.ok) {
        right.innerHTML = '<div class="da-empty">' + esc((r && r.err) || t('common.error')) + '</div>';
        return;
      }
      _renderDriverDetail(r);
    });
  }

  function _renderDriverDetail(r) {
    var right = document.getElementById('daRight');
    if (!right) return;
    var driver = r.driver || {};
    var counts = r.counts || {};

    // Fejléc: avatar + név + kontakt + fuvar-választó + KPI-pilulák
    var orderOpts = '<option value="">' + t('da.allOrders') + ' (' + (r.orders || []).length + ')</option>' +
      (r.orders || []).map(function (o) {
        var label = (o.fuvar_no || o.id) + ' · ' + (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?');
        var sel = (_selectedOrder === o.id) ? ' selected' : '';
        return '<option value="' + esc(o.id) + '"' + sel + '>' + esc(label) + '</option>';
      }).join('');

    var kpiPills =
      '<div class="da-cnt-wrap">'
      + _cntChip('milestone',        '📍', counts.milestone        || 0, t('da.type.milestone'))
      + _cntChip('waybill',          '📄', counts.waybill          || 0, t('da.type.waybill'))
      + _cntChip('fuel',             '⛽', counts.fuel             || 0, t('da.type.fuel'))
      + _cntChip('purchase',         '🛒', counts.purchase         || 0, t('da.type.purchase'))
      + _cntChip('fuel_pending',     '☁️', counts.fuel_pending     || 0, t('da.type.fuel_pending'), 'warn')
      + _cntChip('purchase_pending', '☁️', counts.purchase_pending || 0, t('da.type.purchase_pending'), 'warn')
      + _cntChip('photo',            '📷', counts.photo            || 0, t('da.type.photo'))
      + _cntChip('uit',              '🛣️', counts.uit             || 0, t('da.type.uit'))
      + _cntChip('border',           '🛂', counts.border           || 0, t('da.type.border'))
      + _cntChip('bug',              '🐛', counts.bug              || 0, t('da.type.bug'))
      + '</div>';

    var head =
      '<div class="glass da-detail-head">'
      +   '<div class="da-detail-headtop">'
      +     _avatarHtml(driver.nume || driver.email)
      +     '<div style="flex:1;min-width:0;">'
      +       '<div class="da-detail-nume">' + esc(driver.nume || driver.email) + '</div>'
      +       '<div class="da-detail-email">' + esc(driver.email) +
                  (driver.tel ? ' · ' + esc(driver.tel) : '') + '</div>'
      +     '</div>'
      +     '<div class="field" style="margin:0;min-width:240px;">'
      +       '<label>' + t('da.pickOrder') + '</label>'
      +       '<select class="select" id="daOrderSel" onchange="DriverActivity.onOrderChange(this.value)">'
      +         orderOpts
      +       '</select>'
      +     '</div>'
      +   '</div>'
      +   kpiPills
      + '</div>';

    // Fotó-galéria (ha van fotó)
    var photos = r.photos || [];
    var photoHtml = '';
    if (photos.length) {
      var picsGrid = photos.map(function (p, idx) {
        return '<div class="da-photo" onclick="DriverActivity.openLightbox(' + idx + ')">'
          + '<img loading="lazy" src="' + esc(p.thumb_url) + '" alt="' + esc(p.title) + '">'
          + '<div class="da-photo-cap">' + esc(p.kind) + ' · ' + esc(_fmtDate(p.created_at)) + '</div>'
          + '</div>';
      }).join('');
      photoHtml =
        '<div class="glass da-photos">'
        + '<div class="da-section-title">📷 ' + t('da.photos') + ' (' + photos.length + ')</div>'
        + '<div class="da-photo-grid">' + picsGrid + '</div>'
        + '</div>';
      // Fotó-adatokat globálisan is elérhetővé tesszük a lightboxnak
      window._daPhotos = photos;
    } else {
      window._daPhotos = [];
    }

    // Timeline
    var events = (r.events || []).slice();
    if (_typeFilter) events = events.filter(function (e) { return e.type === _typeFilter; });
    var timelineHtml;
    if (!events.length) {
      timelineHtml = '<div class="glass"><div class="da-empty">'
        + (_typeFilter ? t('da.noEventsFilter') : t('da.noEvents'))
        + '</div></div>';
    } else {
      var rows = events.map(function (ev) {
        var orderTag = ev.order_label
          ? '<span class="da-ev-order">' + esc(ev.order_label) + '</span>' : '';
        var subtitle = ev.subtitle
          ? '<div class="da-ev-sub">' + esc(ev.subtitle) + '</div>' : '';
        var photoBtn = '';
        if (ev.type === 'photo' && ev.meta && ev.meta.url) {
          photoBtn = ' <a href="' + esc(ev.meta.url) + '" target="_blank" rel="noopener" '
            + 'class="btn ghost da-ev-photo-btn" onclick="event.stopPropagation();">🔍 ' + t('da.open') + '</a>';
        }
        // AI-scan pending vs attached badge (a sofőr fényképezte-e csak
        // felhőbe, vagy már bekerült a menetlevélbe).
        var scanBadge = '';
        if (ev.meta && ev.meta.source === 'scan') {
          if (ev.meta.pending) {
            scanBadge = ' <span class="da-scan-badge da-scan-pending">' + esc(t('da.cloud')) + '</span>';
          } else {
            scanBadge = ' <span class="da-scan-badge da-scan-attached">' + esc(t('da.attached')) + '</span>';
          }
        }
        return '<div class="da-ev da-ev-' + esc(ev.type) + '">'
          + '<div class="da-ev-ico">' + (ev.icon || '•') + '</div>'
          + '<div class="da-ev-body">'
          +   '<div class="da-ev-head">'
          +     '<div class="da-ev-title">' + esc(ev.title || '') + orderTag + scanBadge + '</div>'
          +     '<div class="da-ev-when" title="' + esc(_fmtDateTime(ev.at)) + '">' + esc(_fmtDateTime(ev.at)) + '</div>'
          +   '</div>'
          +   subtitle + photoBtn
          + '</div>'
          + '</div>';
      }).join('');
      timelineHtml =
        '<div class="glass da-timeline-wrap">'
        + '<div class="da-section-title">🎬 ' + t('da.timeline') + ' (' + events.length + ')</div>'
        + '<div class="da-timeline">' + rows + '</div>'
        + '</div>';
    }

    right.innerHTML = head + photoHtml + timelineHtml;
  }

  function _cntChip(key, ico, n, label, tone) {
    var isActive = (_typeFilter === key);
    var isEmpty = (n === 0);
    var toneClass = tone ? ' da-cnt-' + tone : '';
    return '<button class="da-cnt-chip ' + (isActive ? 'is-active' : '') + ' ' + (isEmpty ? 'is-empty' : '') + toneClass + '" '
      + 'title="' + esc(label) + '" '
      + 'onclick="DriverActivity.toggleType(\'' + key + '\')">'
      + ico + ' <b>' + n + '</b> <span class="da-cnt-l">' + esc(label) + '</span>'
      + '</button>';
  }

  function onOrderChange(v) {
    _selectedOrder = v || '';
    _typeFilter = null;
    _loadDriverDetail();
  }

  function toggleType(key) {
    _typeFilter = (_typeFilter === key) ? null : key;
    // Csak a right-oldalt renderjük újra a cache-ből — újra kérünk, mert egyszerűbb.
    _loadDriverDetail();
  }

  // ═════════════════════════════════════════════
  //  FOTÓ-LIGHTBOX
  // ═════════════════════════════════════════════
  function _ensureLightbox() {
    if (document.getElementById('daLightbox')) return;
    var m = document.createElement('div');
    m.id = 'daLightbox';
    m.className = 'modal-back';
    m.innerHTML =
      '<div class="modal da-lb-modal">'
      +   '<div class="da-lb-head">'
      +     '<div class="da-lb-title" id="daLbTitle"></div>'
      +     '<button class="btn ghost" onclick="DriverActivity.closeLightbox()">✕</button>'
      +   '</div>'
      +   '<div class="da-lb-body">'
      +     '<button class="da-lb-nav da-lb-prev" onclick="DriverActivity.navLightbox(-1)">‹</button>'
      +     '<img id="daLbImg" src="" alt="">'
      +     '<button class="da-lb-nav da-lb-next" onclick="DriverActivity.navLightbox(1)">›</button>'
      +   '</div>'
      +   '<div class="da-lb-foot" id="daLbFoot"></div>'
      + '</div>';
    m.addEventListener('click', function (ev) {
      if (ev.target === m) closeLightbox();
    });
    document.body.appendChild(m);
  }
  var _lbIdx = 0;
  function openLightbox(idx) {
    _ensureLightbox();
    _lbIdx = idx;
    _renderLightbox();
    document.getElementById('daLightbox').classList.add('open');
  }
  function closeLightbox() {
    var m = document.getElementById('daLightbox');
    if (m) m.classList.remove('open');
  }
  function navLightbox(delta) {
    var arr = window._daPhotos || [];
    if (!arr.length) return;
    _lbIdx = (_lbIdx + delta + arr.length) % arr.length;
    _renderLightbox();
  }
  function _renderLightbox() {
    var arr = window._daPhotos || [];
    if (!arr.length) return;
    var p = arr[_lbIdx];
    document.getElementById('daLbTitle').textContent = (p.kind || '') + ' · ' + _fmtDateTime(p.created_at);
    document.getElementById('daLbImg').src = p.full_url;
    document.getElementById('daLbFoot').innerHTML =
      '<span>' + esc(p.title || '') + '</span>'
      + '<a href="' + esc(p.full_url) + '" target="_blank" rel="noopener" class="btn ghost">🔍 ' + t('da.open') + '</a>';
  }

  // ═════════════════════════════════════════════
  //  PUBLIKUS API
  // ═════════════════════════════════════════════
  window.DriverActivity = {
    mount: mount,
    onRangeChange: onRangeChange,
    applyPreset: applyPreset,
    onSearch: onSearch,
    pickDriver: pickDriver,
    onOrderChange: onOrderChange,
    toggleType: toggleType,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    navLightbox: navLightbox,
  };
})();
