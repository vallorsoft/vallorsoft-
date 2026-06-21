// public/fav-locations.js
// Kedvenc helyszínek (gyakran használt felrakó/lerakó címek) — admin + manager.
// Önálló modul: FavLocations.mount('favLocBox') a fül megnyitásakor.
// Plusz: a fuvar-űrlap cím-mezőihez "⭐ mentett helyek" gyors-választó (attachPicker).
// A meglévő gas()/toast()/t() segédeket használja (console-shared.js + i18n.js).
window.FavLocations = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  var _cache = [];

  function typeLabel(ty) {
    if (ty === 'load') return tt('fav.type.load', 'Felrakó');
    if (ty === 'unload') return tt('fav.type.unload', 'Lerakó');
    return tt('fav.type.both', 'Bármelyik');
  }

  // ── Manager pane ──
  function render(root) {
    var rows;
    if (!_cache.length) {
      rows = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px;">' + tt('fav.none', 'Nincs mentett helyszín.') + '</td></tr>';
    } else {
      rows = _cache.map(function (f) {
        var gps = (f.lat != null) ? ' <span title="' + esc((+f.lat).toFixed(4) + ', ' + (+f.lng).toFixed(4)) + '" style="color:var(--status-ok);font-size:11px;">📍</span>' : '';
        return '<tr>' +
          '<td><b class="text-primary">' + esc(f.label) + '</b></td>' +
          '<td>' + esc(f.address) + gps + '</td>' +
          '<td>' + esc(typeLabel(f.type)) + '</td>' +
          '<td style="white-space:nowrap;"><button class="btn danger" style="padding:3px 9px;font-size:12px;" data-del="' + f.id + '">✕</button></td>' +
          '</tr>';
      }).join('');
    }
    root.innerHTML =
      '<div class="glass" style="padding:22px;max-width:900px;">' +
        '<h2 class="h-title" style="margin-top:0;">' + tt('fav.title', '⭐ Kedvenc helyszínek') + '</h2>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' + tt('fav.intro', 'Gyakran használt felrakó/lerakó címek a fuvar-űrlap gyors kitöltéséhez.') + '</p>' +
        '<div class="grid-3" style="margin-bottom:12px;">' +
          '<div class="field"><label>' + tt('fav.label', 'Megnevezés') + '</label><input class="input" id="favLabel" maxlength="120"></div>' +
          '<div class="field" style="grid-column:span 2;"><label>' + tt('fav.address', 'Cím') + '</label><div class="vs-ac-wrap"><input class="input" id="favAddress" maxlength="300" autocomplete="off"><div class="vs-ac-dd" id="favAddressDD"></div></div></div>' +
          '<div class="field"><label>' + tt('fav.typeLbl', 'Típus') + '</label><select class="select" id="favType">' +
            '<option value="both">' + esc(typeLabel('both')) + '</option>' +
            '<option value="load">' + esc(typeLabel('load')) + '</option>' +
            '<option value="unload">' + esc(typeLabel('unload')) + '</option>' +
          '</select></div>' +
        '</div>' +
        '<button class="btn primary" id="favSaveBtn">' + tt('fav.addBtn', 'Hozzáadás') + '</button>' +
        '<table class="table" style="margin-top:16px;"><thead><tr>' +
          '<th>' + tt('fav.label', 'Megnevezés') + '</th><th>' + tt('fav.address', 'Cím') + '</th>' +
          '<th>' + tt('fav.typeLbl', 'Típus') + '</th><th>' + tt('col.action', 'Művelet') + '</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>';
    var sb = root.querySelector('#favSaveBtn');
    if (sb) sb.addEventListener('click', doSave);
    Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () { doDelete(parseInt(b.getAttribute('data-del'), 10)); });
    });
    if (typeof vsAttachAutocomplete === 'function') {
      vsAttachAutocomplete('favAddress', 'favAddressDD', function () { /* lat/lng a input._vsLat/_vsLng-n */ });
    }
  }

  function doSave() {
    var label = (document.getElementById('favLabel') || {}).value || '';
    var addrEl = document.getElementById('favAddress');
    var address = (addrEl || {}).value || '';
    var type = (document.getElementById('favType') || {}).value || 'both';
    label = label.trim(); address = address.trim();
    if (!label) { toast(tt('fav.labelReq', 'A megnevezés kötelező.'), 'err'); return; }
    if (!address) { toast(tt('fav.addressReq', 'A cím kötelező.'), 'err'); return; }
    var lat = addrEl && addrEl._vsLat != null ? addrEl._vsLat : null;
    var lng = addrEl && addrEl._vsLng != null ? addrEl._vsLng : null;
    gas('favLocationSave', [{ label: label, address: address, type: type, lat: lat, lng: lng }]).then(function (r) {
      if (r && r.ok) { toast(tt('common.saved', 'Mentve!'), 'ok'); reload(); }
      else toast((r && r.err) || tt('common.error', 'Hiba'), 'err');
    });
  }

  function doDelete(id) {
    if (!window.confirm(tt('fav.delConfirm', 'Törlöd ezt a helyszínt?'))) return;
    gas('favLocationDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(tt('common.deleted', 'Törölve'), 'ok'); reload(); }
      else toast((r && r.err) || tt('common.error', 'Hiba'), 'err');
    });
  }

  var _root = null;
  function fetchList() {
    return gas('favLocationList', []).then(function (r) {
      _cache = (r && r.ok && r.items) ? r.items : [];
      return _cache;
    }).catch(function () { _cache = []; return _cache; });
  }
  function reload() { if (_root) fetchList().then(function () { render(_root); }); }
  function mount(target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn('fav-locations.js: nincs konténer'); return; }
    _root = el;
    el.innerHTML = '<div style="padding:14px;color:var(--muted)">…</div>';
    reload();
  }

  // ── Gyors-választó a fuvar-űrlap cím-mezőihez ──
  // inputId: a cím-input; fillType: 'load'|'unload' (mit szűrjön); onPick: callback a kitöltés után
  function attachPicker(inputId, fillType, onPick) {
    var input = document.getElementById(inputId);
    if (!input || input._favPickerBound) return;
    input._favPickerBound = true;
    var wrap = input.parentElement; // .vs-ac-wrap
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost';
    btn.style.cssText = 'padding:3px 8px;font-size:12px;margin-top:4px;';
    btn.textContent = tt('fav.quickPick', '⭐ mentett helyek');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openMenu(input, fillType, onPick, btn);
    });
    if (wrap && wrap.parentElement) wrap.parentElement.insertBefore(btn, wrap.nextSibling);
  }

  function openMenu(input, fillType, onPick, anchor) {
    // egyszer betöltjük a listát (cache), majd legördülő menü
    var doOpen = function () {
      var rel = _cache.filter(function (f) { return f.type === 'both' || f.type === fillType; });
      // régi menü eltávolítása
      var old = document.getElementById('favPickMenu'); if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'favPickMenu';
      m.className = 'glass';
      m.style.cssText = 'position:absolute;z-index:9999;max-height:260px;overflow:auto;min-width:220px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.25);';
      if (!rel.length) {
        m.innerHTML = '<div style="padding:8px 10px;color:var(--muted);font-size:12.5px;">' + tt('fav.none', 'Nincs mentett helyszín.') + '</div>';
      } else {
        m.innerHTML = rel.map(function (f) {
          var lat = f.lat != null ? f.lat : '';
          var lng = f.lng != null ? f.lng : '';
          var gpsBadge = f.lat != null ? '<span style="color:var(--status-ok);font-size:10px;margin-left:4px;">📍</span>' : '';
          return '<div class="fav-pick-item" data-addr="' + esc(f.address) + '" data-lat="' + lat + '" data-lng="' + lng + '" style="padding:7px 10px;cursor:pointer;border-radius:6px;font-size:13px;">' +
            '<b class="text-primary">' + esc(f.label) + '</b>' + gpsBadge + '<div style="font-size:11.5px;color:var(--muted);">' + esc(f.address) + '</div></div>';
        }).join('');
      }
      document.body.appendChild(m);
      var r = anchor.getBoundingClientRect();
      m.style.left = (window.scrollX + r.left) + 'px';
      m.style.top = (window.scrollY + r.bottom + 4) + 'px';
      Array.prototype.forEach.call(m.querySelectorAll('.fav-pick-item'), function (el) {
        el.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          input.value = el.getAttribute('data-addr');
          var lat = parseFloat(el.getAttribute('data-lat'));
          var lng = parseFloat(el.getAttribute('data-lng'));
          input._vsLat = isNaN(lat) ? null : lat;
          input._vsLng = isNaN(lng) ? null : lng;
          m.remove();
          if (typeof onPick === 'function') onPick(input._vsLat, input._vsLng);
        });
      });
      setTimeout(function () {
        document.addEventListener('mousedown', function close(ev) {
          if (!m.contains(ev.target) && ev.target !== anchor) { m.remove(); document.removeEventListener('mousedown', close); }
        });
      }, 0);
    };
    if (_cache.length) doOpen(); else fetchList().then(doOpen);
  }

  return { mount: mount, attachPicker: attachPicker };
})();
