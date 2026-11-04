// ============================================================
//  VallorSoft — public/stop-address.js
//  📍 Tényleges fel-/lerakási címek a GPS-ből (Flotta fül, CSAK Admin/Manager).
//  A diszpécser által beírt (pl. csak városnév) cím mellé a rendszer a jármű
//  GPS-állásaiból felismert pontos helyet mutatja; az iroda elfogadja,
//  elveti, másik jelöltet választ vagy kézzel javít. Az elfogadott hely a
//  helymemóriába kerül (Kedvenc helyszínek), így legközelebb azonnal ismert.
//  Backend: handlers/stopMatch.js. Közös segédek: gas, toast, t, esc.
// ============================================================
(function () {
  'use strict';
  var S = { from: null, to: null, status: 'pending', q: '', rows: [], open: {} };

  function _t(k, d) { try { var v = (typeof t === 'function') ? t(k) : null; return (v && v !== k) ? v : (d || k); } catch (e) { return d || k; } }
  function _e(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _toast(m, k) { if (typeof toast === 'function') toast(m, k || 'ok'); }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function dt(v) { if (!v) return ''; var d = new Date(v); if (isNaN(d.getTime())) return ''; return d.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function mins(a, b) { if (!a || !b) return null; var m = Math.round((new Date(b) - new Date(a)) / 60000); return isFinite(m) ? m : null; }
  function dur(m) { if (m == null) return ''; return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; }
  function osm(lat, lng) { return 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) + '&mlon=' + encodeURIComponent(lng) + '#map=17/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lng); }

  var ST = {
    auto:      { cls: 'ok',   k: 'sa.st.auto',      d: 'Sigur' },
    suggested: { cls: 'warn', k: 'sa.st.suggested', d: 'Propunere' },
    unmatched: { cls: 'info', k: 'sa.st.unmatched', d: 'Negăsit' },
    confirmed: { cls: 'ok',   k: 'sa.st.confirmed', d: 'Confirmat' },
    rejected:  { cls: 'err',  k: 'sa.st.rejected',  d: 'Respins' },
  };
  var SIG = {
    memory: 'sa.sig.memory', firma_near: 'sa.sig.firma', city_dist: 'sa.sig.city', city_name: 'sa.sig.cityName',
    county_name: 'sa.sig.county', poi_name: 'sa.sig.poi', bad_place: 'sa.sig.badPlace', industrial: 'sa.sig.industrial',
    date: 'sa.sig.date', after_button: 'sa.sig.afterBtn', before_button: 'sa.sig.beforeBtn', duration: 'sa.sig.duration',
    short_dwell: 'sa.sig.short', maneuver: 'sa.sig.maneuver', offroad: 'sa.sig.offroad', night_rest: 'sa.sig.night',
    refuel: 'sa.sig.refuel', home_base: 'sa.sig.home',
  };

  function shell() {
    var box = document.getElementById('stopAddressBox');
    if (!box) return null;
    if (!S.from) { var n = new Date(); S.to = ymd(n); S.from = ymd(new Date(n.getTime() - 30 * 86400000)); }
    if (!box.querySelector('#saBody')) {
      box.innerHTML =
        '<div class="glass" style="padding:18px 20px;margin-bottom:14px;">'
        + '<div class="h-title" style="margin-bottom:6px;">📍 ' + _t('sa.title', 'Adrese reale de încărcare / descărcare (GPS)') + '</div>'
        + '<div class="text-muted" style="font-size:13px;margin-bottom:12px;">' + _t('sa.hint', 'Sistemul caută în traseul GPS locul unde camionul a staționat la încărcare/descărcare și îl completează cu adresa exactă. Vizibil doar pentru Admin/Manager.') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">'
        + '<label class="field" style="min-width:140px;"><span>' + _t('sa.from', 'De la') + '</span><input type="date" class="input" id="saFrom"></label>'
        + '<label class="field" style="min-width:140px;"><span>' + _t('sa.to', 'Până la') + '</span><input type="date" class="input" id="saTo"></label>'
        + '<label class="field" style="min-width:160px;"><span>' + _t('sa.status', 'Stare') + '</span><select class="select" id="saStatus">'
        + '<option value="pending">' + _t('sa.f.pending', 'De verificat') + '</option>'
        + '<option value="">' + _t('sa.f.all', 'Toate') + '</option>'
        + ['auto', 'suggested', 'unmatched', 'confirmed', 'rejected'].map(function (k) { return '<option value="' + k + '">' + _t(ST[k].k, ST[k].d) + '</option>'; }).join('')
        + '<option value="none">' + _t('sa.f.none', 'Neprocesat') + '</option>'
        + '</select></label>'
        + '<label class="field" style="flex:1;min-width:180px;"><span>' + _t('sa.search', 'Căutare') + '</span><input class="input" id="saQ" placeholder="' + _t('sa.searchPh', 'Nr. cursă, client, oraș, camion…') + '"></label>'
        + '<button class="btn primary" onclick="StopAddress.reload()">🔎 ' + _t('sa.show', 'Afișează') + '</button>'
        + '<button class="btn" onclick="StopAddress.backfill()">🔄 ' + _t('sa.backfill', 'Rulează pentru perioadă') + '</button>'
        + '<button class="btn ghost" onclick="StopAddress.probe()">🛰️ ' + _t('sa.probe', 'Date dispozitiv GPS') + '</button>'
        + '</div>'
        + '<div id="saCounts" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;"></div>'
        + '<div id="saProbe"></div>'
        + '</div>'
        + '<div class="glass" style="padding:10px 12px;"><div id="saBody" style="overflow-x:auto;"></div></div>';
      var f = box.querySelector('#saFrom'), tt = box.querySelector('#saTo'), st = box.querySelector('#saStatus'), q = box.querySelector('#saQ');
      f.value = S.from; tt.value = S.to; st.value = S.status; q.value = S.q;
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') reload(); });
      st.addEventListener('change', reload);
    }
    return box;
  }

  function readFilters() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    S.from = g('saFrom') || S.from; S.to = g('saTo') || S.to; S.status = g('saStatus'); S.q = g('saQ').trim();
  }

  function reload() {
    if (!shell()) return;
    readFilters();
    var body = document.getElementById('saBody');
    body.innerHTML = '<div class="text-muted" style="padding:14px;">⏳ ' + _t('sa.loading', 'Se încarcă…') + '</div>';
    gas('stopMatchList', [{ from: S.from, to: S.to, status: S.status, q: S.q }]).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="text-muted" style="padding:14px;">' + _e((r && r.err) || 'Eroare') + '</div>'; return; }
      S.rows = r.rows || [];
      renderCounts(r.counts || {}, r.queue || 0);
      render();
    }).catch(function () { body.innerHTML = '<div class="text-muted" style="padding:14px;">Eroare de rețea</div>'; });
  }

  function renderCounts(c, queue) {
    var el = document.getElementById('saCounts'); if (!el) return;
    var html = ['auto', 'suggested', 'unmatched', 'confirmed', 'rejected'].map(function (k) {
      return '<span class="badge ' + ST[k].cls + '">' + _t(ST[k].k, ST[k].d) + ': ' + (c[k] || 0) + '</span>';
    }).join('');
    html += '<span class="badge">' + _t('sa.f.none', 'Neprocesat') + ': ' + (c.none || 0) + '</span>';
    if (queue) html += '<span class="badge info">⏳ ' + _t('sa.queue', 'În coadă') + ': ' + queue + '</span>';
    el.innerHTML = html;
  }

  function signalsHtml(detail) {
    if (!detail || !Array.isArray(detail.signals) || !detail.signals.length) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + detail.signals.map(function (s) {
      var v = s[1];
      return '<span class="badge ' + (v > 0 ? 'ok' : 'err') + '" style="font-weight:600;">' + _e(_t(SIG[s[0]] || s[0], s[0])) + ' ' + (v > 0 ? '+' : '') + v + '</span>';
    }).join('') + '</div>';
  }

  function render() {
    var body = document.getElementById('saBody'); if (!body) return;
    if (!S.rows.length) { body.innerHTML = '<div class="text-muted" style="padding:14px;">' + _t('sa.empty', 'Nu există puncte pentru filtrul ales. Folosește „Rulează pentru perioadă" pentru cursele mai vechi.') + '</div>'; return; }
    var h = '<table class="table" style="min-width:880px;"><thead><tr>'
      + '<th style="min-width:120px;">' + _t('sa.c.order', 'Cursă') + '</th>'
      + '<th style="min-width:170px;">' + _t('sa.c.planned', 'Planificat') + '</th>'
      + '<th>' + _t('sa.c.actual', 'Conform GPS') + '</th>'
      + '<th>' + _t('sa.c.score', 'Siguranță') + '</th>'
      + '<th>' + _t('sa.c.actions', 'Acțiuni') + '</th>'
      + '</tr></thead><tbody>';
    S.rows.forEach(function (r) {
      var st = ST[r.match_status] || null;
      var dm = mins(r.gps_arrived_at, r.gps_left_at);
      var det = r.match_detail || {};
      var cands = Array.isArray(det.candidates) ? det.candidates : [];
      var actual = r.actual_address || (r.actual_lat != null ? (Number(r.actual_lat).toFixed(5) + ', ' + Number(r.actual_lng).toFixed(5)) : '');
      h += '<tr>'
        + '<td><div style="font-weight:700;">' + _e(r.fuvar_no || r.order_id) + '</div>'
        + '<div class="text-muted" style="font-size:12px;">' + _e(r.rendszam_camion || '') + (r.client ? ' · ' + _e(r.client) : '') + '</div></td>'
        + '<td><div>' + (r.kind === 'pickup' ? '⬆️ ' : '⬇️ ') + _e(r.loc || '—') + '</div>'
        + '<div class="text-muted" style="font-size:12px;">' + _e(r.firma || '') + (r.data ? ' · ' + _e(r.data) : '') + '</div></td>'
        + '<td>' + (actual ? '<div>📍 ' + _e(actual) + (r.actual_lat != null ? ' <a href="' + osm(r.actual_lat, r.actual_lng) + '" target="_blank" rel="noopener">🗺️</a>' : '') + '</div>' : '<span class="text-muted">—</span>')
        + (r.gps_arrived_at ? '<div class="text-muted" style="font-size:12px;">⏱ ' + _e(dt(r.gps_arrived_at)) + ' – ' + _e(dt(r.gps_left_at)) + (dm != null ? ' (' + dur(dm) + ')' : '') + '</div>' : '')
        + (S.open[r.id] ? signalsHtml(det) : '')
        + '</td>'
        + '<td>' + (st ? '<span class="badge ' + st.cls + '">' + _t(st.k, st.d) + '</span>' : '<span class="badge">' + _t('sa.f.none', 'Neprocesat') + '</span>')
        + (r.match_score != null ? '<div class="text-muted" style="font-size:12px;margin-top:3px;">' + _e(r.match_score) + ' ' + _t('sa.points', 'pct') + '</div>' : '') + '</td>'
        + '<td style="white-space:nowrap;">'
        + ((r.match_status === 'auto' || r.match_status === 'suggested') ? '<button class="btn ok" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'confirm\')" title="' + _t('sa.a.confirm', 'Acceptă') + '">✓</button> ' : '')
        + (r.match_status !== 'rejected' && r.match_status ? '<button class="btn danger" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'reject\')" title="' + _t('sa.a.reject', 'Respinge') + '">✕</button> ' : '')
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.toggle(' + r.id + ')" title="' + _t('sa.a.details', 'Detalii / alt candidat') + '">' + (S.open[r.id] ? '▾' : '▸') + '</button> '
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.edit(' + r.id + ')" title="' + _t('sa.a.edit', 'Adresă manuală') + '">✏️</button> '
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.rerun(\'' + _e(r.order_id) + '\')" title="' + _t('sa.a.rerun', 'Recalculează cursa') + '">🔄</button>'
        + '</td></tr>';
      if (S.open[r.id]) {
        h += '<tr><td colspan="5" style="background:rgba(99,102,241,0.05);">'
          + '<div style="font-weight:700;margin-bottom:6px;">' + _t('sa.cands', 'Candidați din traseul GPS') + '</div>'
          + (cands.length ? cands.map(function (c, i) {
            var m = mins(c.from, c.to);
            return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.25);">'
              + '<span class="badge info">' + _e(c.score) + ' ' + _t('sa.points', 'pct') + '</span>'
              + '<span style="flex:1;min-width:200px;">📍 ' + _e(c.address || (c.lat + ', ' + c.lng)) + ' <a href="' + osm(c.lat, c.lng) + '" target="_blank" rel="noopener">🗺️</a></span>'
              + '<span class="text-muted" style="font-size:12px;">⏱ ' + _e(dt(c.from)) + ' – ' + _e(dt(c.to)) + (m != null ? ' (' + dur(m) + ')' : '') + '</span>'
              + '<button class="btn" style="padding:4px 10px;" onclick="StopAddress.pick(' + r.id + ',' + i + ')">' + _t('sa.a.pick', 'Alege') + '</button>'
              + '</div>';
          }).join('') : '<div class="text-muted">' + _t('sa.noCands', 'Nu s-a găsit nicio staționare potrivită (min. 20 min) în perioada cursei.') + '</div>')
          + '</td></tr>';
      }
    });
    body.innerHTML = h + '</tbody></table>';
  }

  function decide(id, action, extra) {
    var a = Object.assign({ stop_id: id, action: action }, extra || {});
    gas('stopMatchDecide', [a]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      _toast(_t('sa.saved', 'Salvat'));
      reload();
    });
  }

  var StopAddress = {
    load: function () { if (shell()) reload(); },
    reload: reload,
    toggle: function (id) { S.open[id] = !S.open[id]; render(); },
    decide: decide,
    pick: function (id, i) { decide(id, 'pick', { cand_idx: i }); },
    edit: function (id) {
      var r = S.rows.find(function (x) { return x.id === id; }) || {};
      var v = window.prompt(_t('sa.editPrompt', 'Adresa exactă:'), r.actual_address || r.loc || '');
      if (v == null) return;
      decide(id, 'edit', { address: v });
    },
    rerun: function (oid) {
      gas('stopMatchRerun', [{ order_id: oid }]).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        _toast(_t('sa.rerunStarted', 'Recalculare pornită — reîncarcă lista peste ~1 minut.'));
      });
    },
    backfill: function () {
      readFilters();
      if (!window.confirm(_t('sa.backfillConfirm', 'Pun în coadă toate cursele din perioada selectată? Procesarea rulează în fundal.'))) return;
      gas('stopMatchBackfill', [{ from: S.from, to: S.to }]).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        _toast(_t('sa.backfillQueued', 'Curse puse în coadă') + ': ' + r.queued);
        reload();
      });
    },
    probe: function () {
      var el = document.getElementById('saProbe'); if (!el) return;
      el.innerHTML = '<div class="text-muted" style="margin-top:10px;">⏳ ' + _t('sa.loading', 'Se încarcă…') + '</div>';
      gas('stopMatchProbe', [{}]).then(function (r) {
        if (!r || !r.ok) { el.innerHTML = '<div class="text-muted" style="margin-top:10px;">' + _e((r && r.err) || 'Eroare') + '</div>'; return; }
        var html = '<div style="margin-top:12px;">';
        (r.vehicles || []).forEach(function (v) {
          var keys = Object.keys(v.interesting || {});
          html += '<div style="padding:8px 0;border-top:1px solid rgba(148,163,184,0.25);"><b>' + _e(v.rendszam) + '</b> — '
            + (!v.found ? '<span class="text-muted">' + _t('sa.probeNone', 'nu există date recente') + '</span>'
              : (keys.length ? '<span class="badge ok">' + _t('sa.probeExtra', 'Câmpuri suplimentare găsite') + '</span> ' + keys.map(function (k) { return '<code>' + _e(k) + '=' + _e(v.interesting[k]) + '</code>'; }).join(' ')
                : '<span class="badge info">' + _t('sa.probeOnlyBasic', 'doar câmpuri de bază (fără tahograf / sarcină pe axă / ușă)') + '</span>'))
            + (v.found ? '<details style="margin-top:4px;"><summary class="text-muted" style="cursor:pointer;font-size:12px;">' + _t('sa.probeAll', 'Toate câmpurile') + ' (' + (v.keys || []).length + ')</summary><div style="font-size:12px;word-break:break-all;">' + _e((v.keys || []).join(', ')) + '</div></details>' : '')
            + '</div>';
        });
        el.innerHTML = html + '</div>';
      });
    },
  };
  window.StopAddress = StopAddress;
  window.loadStopAddress = StopAddress.load;
})();
