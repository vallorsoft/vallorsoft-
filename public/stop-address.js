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
  var S = { from: null, to: null, status: 'pending', q: '', rows: [], open: {}, secOpen: {}, devStatus: 'deviation' };

  function _t(k, d, vars) {
    var v;
    try { v = (typeof t === 'function') ? t(k) : null; } catch (e) { v = null; }
    v = (v && v !== k) ? v : (d || k);
    if (vars) Object.keys(vars).forEach(function (x) { v = String(v).split('{' + x + '}').join(vars[x]); });
    return v;
  }
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
    rejected_before: 'sa.sig.rejBefore', rejected_place: 'sa.sig.rejPlace', homonym: 'sa.sig.homonym',
    rest_then_moved: 'sa.sig.restMoved', break_then_moved: 'sa.sig.breakMoved', after_rest: 'sa.sig.afterRest',
    short_site: 'sa.sig.shortSite', before_prev: 'sa.sig.beforePrev',
    saved_place: 'sa.sig.savedPlace', next_done: 'sa.sig.nextDone', next_button: 'sa.sig.nextButton',
    visit_day: 'sa.sig.visitDay', visit_site: 'sa.sig.visitSite', visit_city: 'sa.sig.visitCity', pass_city: 'sa.sig.passCity',
  };

  function shell() {
    var box = document.getElementById('stopAddressBox');
    if (!box) return null;
    if (!S.from) { var n = new Date(); S.to = ymd(n); S.from = ymd(new Date(n.getTime() - 30 * 86400000)); }
    if (!box.querySelector('#saBody')) {
      box.innerHTML =
        '<div class="glass" style="padding:18px 20px;margin-bottom:14px;">'
        + '<div class="h-title" style="margin-bottom:6px;">📍 ' + _t('sa.title', 'Locuri de încărcare / descărcare din GPS — verificare și trecere pe foaia de parcurs') + '</div>'
        + '<div class="text-muted" style="font-size:13px;margin-bottom:12px;">' + _t('sa.hint', 'Sistemul caută în traseul GPS locul unde camionul a staționat la încărcare/descărcare și îl completează cu adresa exactă. Vizibil doar pentru Admin/Manager.') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">'
        + '<label class="field" style="min-width:140px;"><span>' + _t('sa.from', 'De la') + '</span><input type="date" class="input" id="saFrom"></label>'
        + '<label class="field" style="min-width:140px;"><span>' + _t('sa.to', 'Până la') + '</span><input type="date" class="input" id="saTo"></label>'
        + '<label class="field" style="min-width:160px;"><span>' + _t('sa.status', 'Stare') + '</span><select class="select" id="saStatus">'
        + '<option value="pending">' + _t('sa.f.pending', 'De verificat') + '</option>'
        + '<option value="">' + _t('sa.f.all', 'Toate') + '</option>'
        + ['auto', 'suggested', 'unmatched', 'confirmed', 'rejected'].map(function (k) { return '<option value="' + k + '">' + _t(ST[k].k, ST[k].d) + '</option>'; }).join('')
        + '<option value="manual">✋ ' + _t('sa.f.manual', 'Așteaptă confirmare manuală') + '</option>'
        + '<option value="none">' + _t('sa.f.none', 'Neprocesat') + '</option>'
        + '</select></label>'
        + '<label class="field" style="flex:1;min-width:180px;"><span>' + _t('sa.search', 'Căutare') + '</span><input class="input" id="saQ" placeholder="' + _t('sa.searchPh', 'Nr. cursă, client, oraș, camion…') + '"></label>'
        + '<button class="btn primary" onclick="StopAddress.reload()">🔎 ' + _t('sa.show', 'Afișează') + '</button>'
        + '<button class="btn" onclick="StopAddress.backfill()">🔄 ' + _t('sa.backfill', 'Rulează pentru perioadă') + '</button>'
        + '<button class="btn ghost" onclick="StopAddress.probe()">🛰️ ' + _t('sa.probe', 'Date dispozitiv GPS') + '</button>'
        + '</div>'
        + '<div id="saCounts" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;"></div>'
        + '<div id="saSettings" style="margin-top:12px;padding:10px 12px;border:1px solid rgba(148,163,184,0.35);border-radius:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">'
        + '<label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;"><input type="checkbox" id="saAuto" style="width:18px;height:18px;"> 📄 ' + _t('sa.autoApply', 'Pune automat adresa pe foaia de parcurs') + '</label>'
        + '<label style="display:flex;align-items:center;gap:6px;">' + _t('sa.minScore', 'peste') + ' <input type="number" class="input" id="saMin" min="30" max="200" step="5" style="width:90px;"> ' + _t('sa.points', 'pct') + '</label>'
        + '<label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;flex-basis:100%;"><input type="checkbox" id="saAutoEv" style="width:18px;height:18px;"> 🤖 ' + _t('sa.autoEvents', 'Dacă șoferul uită să marcheze sosirea / încărcarea / descărcarea, sistemul o marchează din GPS (doar la recunoaștere sigură); șoferul confirmă sau corectează la următoarea intrare') + '</label>'
        + '<button class="btn" id="saSaveSet" onclick="StopAddress.saveSettings()">💾 ' + _t('sa.saveSet', 'Salvează') + '</button>'
        + '<button class="btn" onclick="StopAddress.applyBulk()">📄 ' + _t('sa.applyBulk', 'Pune pe foile de parcurs toate confirmatele din perioadă') + '</button>'
        + '<div class="text-muted" style="font-size:12px;flex-basis:100%;">🧠 ' + _t('sa.learnHint', 'Sistemul învață din deciziile tale: ce accepți devine loc cunoscut, ce respingi nu mai este propus pentru aceeași firmă; după fiecare decizie restul curselor se recalculează.') + '</div>'
        + '<div class="text-muted" style="font-size:12px;flex-basis:100%;">' + _t('sa.autoHint', 'Recomandat: 80+ pct. Adresa originală rămâne salvată și poate fi restaurată oricând (↩).') + '</div>'
        + '</div>'
        + '<div id="saProbe"></div>'
        + '</div>'
        + '<div class="glass" style="padding:10px 12px;margin-bottom:12px;"><div id="saAcc"></div></div>'
        + '<div class="glass" style="padding:10px 12px;margin-bottom:12px;"><div id="saDev"></div></div>'
        + '<div class="glass" style="padding:10px 12px;"><div id="saBody" style="overflow-x:auto;"></div></div>';
      var f = box.querySelector('#saFrom'), tt = box.querySelector('#saTo'), st = box.querySelector('#saStatus'), q = box.querySelector('#saQ');
      f.value = S.from; tt.value = S.to; st.value = S.status; q.value = S.q;
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') reload(); });
      st.addEventListener('change', reload);
      ['saAuto', 'saMin', 'saAutoEv'].forEach(function (id) { var el = box.querySelector('#' + id); if (el) el.addEventListener('change', function () { S.setTouched = true; }); });
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
      S.recheck = r.recheck || S.recheck;
      renderCounts(r.counts || {}, r.queue || 0);
      if (r.settings) {
        var au = document.getElementById('saAuto'), mn = document.getElementById('saMin');
        if (au && !S.setTouched) {
          au.checked = !!r.settings.auto_apply; mn.value = r.settings.min_score;
          var ae = document.getElementById('saAutoEv'); if (ae) ae.checked = r.settings.auto_events !== false;
        }
      }
      render();
    }).catch(function () { body.innerHTML = '<div class="text-muted" style="padding:14px;">Eroare de rețea</div>'; });
    loadAcc();
    loadDev();
  }

  // ── 📊 Pontosság (havi visszamérés) ──
  function _secHead(key, title, extra) {
    var open = !!S.secOpen[key];
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;" onclick="StopAddress.sec(\'' + key + '\')">'
      + '<b style="flex:1;min-width:200px;">' + (open ? '▾ ' : '▸ ') + _e(title) + '</b>' + (extra || '') + '</div>';
  }
  function loadAcc() {
    var el = document.getElementById('saAcc'); if (!el) return;
    gas('stopMatchAccuracyList', []).then(function (r) {
      if (!r || !r.ok) { el.innerHTML = ''; return; }
      S.acc = r;
      renderAcc();
    }).catch(function () {});
  }
  function renderAcc() {
    var el = document.getElementById('saAcc'), r = S.acc; if (!el || !r) return;
    var last = (r.rows || [])[0], t0 = last ? last.totals || {} : null;
    var badge = t0 ? '<span class="badge ' + ((t0.auto_wrong || 0) > 0 ? 'warn' : 'ok') + '" onclick="event.stopPropagation()">' + _e(t0.hit_pct != null ? t0.hit_pct + '%' : '—') + ' · ' + _t('sa.accAutoWrong', 'Sigur, dar greșit') + ': ' + (t0.auto_wrong || 0) + '</span>' : '';
    var html = _secHead('acc', _t('sa.accTitle', 'Precizia recunoașterii adreselor'), badge);
    if (S.secOpen.acc) {
      html += '<div class="text-muted" style="font-size:12px;margin:8px 0;">' + _e(_t('sa.accHint', '')) + '</div>'
        + '<button class="btn" ' + (r.running ? 'disabled' : '') + ' onclick="StopAddress.accRun()">' + (r.running ? '⏳ ' + _t('sa.accRunning', 'Măsurare în curs…') : _t('sa.accRun', '▶ Măsoară acum')) + '</button>';
      if (!(r.rows || []).length) html += '<div class="text-muted" style="padding:10px 0;">' + _t('sa.accNone', 'Încă nu există măsurători.') + '</div>';
      else {
        html += '<div style="overflow-x:auto;margin-top:10px;"><table class="table"><thead><tr><th>' + _t('sa.accMonth', 'Luna') + '</th><th>' + _t('sa.accStops', 'Puncte')
          + '</th><th>' + _t('sa.accHit', 'Corect') + '</th><th>' + _t('sa.accNoneFound', 'Negăsit') + '</th><th>' + _t('sa.accAutoWrong', 'Sigur, dar greșit') + '</th></tr></thead><tbody>'
          + r.rows.map(function (x) {
            var t = x.totals || {};
            return '<tr><td>' + _e(x.period) + '</td><td>' + (t.stops || 0) + '</td><td><b>' + (t.hit || 0) + '</b>' + (t.hit_pct != null ? ' (' + t.hit_pct + '%)' : '') + '</td><td>' + (t.none || 0)
              + '</td><td>' + ((t.auto_wrong || 0) > 0 ? '<span class="badge warn">' + t.auto_wrong + '</span>' : '0') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
    }
    el.innerHTML = html;
  }

  // ── 🛣️ Útvonal-eltérés ──
  function loadDev() {
    var el = document.getElementById('saDev'); if (!el) return;
    gas('routeDeviationList', [{ from: S.from, to: S.to, status: S.devStatus || '' }]).then(function (r) {
      if (!r || !r.ok) { el.innerHTML = ''; return; }
      S.dev = r;
      renderDev();
    }).catch(function () {});
  }
  function renderDev() {
    var el = document.getElementById('saDev'), r = S.dev; if (!el || !r) return;
    var c = r.counts || {};
    var badge = '<span class="badge ' + ((c.deviation || 0) ? 'warn' : 'ok') + '">' + _t('sa.devDeviation', 'Abatere') + ': ' + (c.deviation || 0) + '</span>'
      + ' <span class="badge ok">' + _t('sa.devOk', 'În regulă') + ': ' + (c.ok || 0) + '</span>';
    var html = _secHead('dev', _t('sa.devTitle', 'Abatere de traseu'), badge);
    if (S.secOpen.dev) {
      var st = S.devStatus || '';
      html += '<div class="text-muted" style="font-size:12px;margin:8px 0;">' + _e(_t('sa.devHint', '')) + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'
        + [['', _t('sa.f.all', 'Toate')], ['deviation', _t('sa.devDeviation', 'Abatere')], ['ok', _t('sa.devOk', 'În regulă')], ['no_data', _t('sa.devNoData', 'Fără date')]]
          .map(function (o) { return '<button class="btn' + (st === o[0] ? ' primary' : ' ghost') + '" style="padding:5px 10px;" onclick="StopAddress.devFilter(\'' + o[0] + '\')">' + _e(o[1]) + '</button>'; }).join('')
        + (window.RouteDevMap ? '<button class="btn ghost" style="padding:5px 10px;margin-left:auto;" onclick="RouteDevMap.open({from:\'' + _e(S.from) + '\',to:\'' + _e(S.to) + '\',status:\'' + _e(st === 'no_data' ? '' : st) + '\'})">🗺️ ' + _e(_t('sa.devMapPeriod', 'Hartă pentru perioadă')) + '</button>' : '')
        + '</div>';
      var rows = r.rows || [];
      if (!rows.length) html += '<div class="text-muted" style="padding:8px 0;">' + _t('sa.devNone', 'Nu există curse verificate.') + '</div>';
      else {
        html += '<div style="overflow-x:auto;"><table class="table"><thead><tr><th>#</th><th>' + _t('sa.route', 'Traseu') + '</th><th>' + _t('sa.devPlanned', 'Planificat')
          + '</th><th>' + _t('sa.devActual', 'GPS') + '</th><th>' + _t('sa.devDiff', 'Diferență') + '</th><th></th></tr></thead><tbody>'
          + rows.map(function (x) {
            var cls = x.status === 'deviation' ? 'warn' : x.status === 'ok' ? 'ok' : '';
            var lab = x.status === 'deviation' ? _t('sa.devDeviation', 'Abatere') : x.status === 'ok' ? _t('sa.devOk', 'În regulă') : _t('sa.devNoData', 'Fără date');
            return '<tr><td><b>' + _e(x.fuvar_no || x.order_id) + '</b><div class="text-muted" style="font-size:12px;">' + _e(x.rendszam_camion || '') + (x.nume_sofer ? ' · ' + _e(x.nume_sofer) : '') + '</div></td>'
              + '<td style="font-size:12.5px;">' + _e(x.loc_incarcare || '?') + ' → ' + _e(x.loc_descarcare || '?') + '<div class="text-muted" style="font-size:12px;">' + _e(dt(x.from_at)) + ' – ' + _e(dt(x.to_at)) + '</div></td>'
              + '<td>' + (x.planned_km != null ? _e(Number(x.planned_km)) + ' km' : '—') + '<div class="text-muted" style="font-size:11px;">' + _e(x.source === 'here' ? 'HERE' : x.source ? 'OSRM' : '') + '</div></td>'
              + '<td>' + (x.actual_km != null ? _e(Number(x.actual_km)) + ' km' : '—') + '<div class="text-muted" style="font-size:11px;">' + _e(x.km_source === 'odo' ? 'km-óra / odometru' : x.km_source ? 'GPS' : '') + '</div></td>'
              + '<td><span class="badge ' + cls + '">' + _e(lab) + '</span>' + (x.diff_km != null ? '<div style="font-size:12px;margin-top:3px;">' + (Number(x.diff_km) > 0 ? '+' : '') + _e(Number(x.diff_km)) + ' km (' + (Number(x.diff_pct) > 0 ? '+' : '') + _e(Number(x.diff_pct)) + '%)</div>' : '') + '</td>'
              + '<td style="white-space:nowrap;">' + (window.RouteDevMap && x.status !== 'no_data' ? '<button class="btn ghost" style="padding:5px 9px;" title="' + _t('sa.devMap', 'Hartă: plan vs. real') + '" onclick="RouteDevMap.open({order_id:\'' + _e(String(x.order_id)) + '\'})">🗺️</button> ' : '')
              + '<button class="btn ghost" style="padding:5px 9px;" title="' + _t('sa.devRecheck', 'Reverifică') + '" onclick="StopAddress.devRecheck(\'' + _e(String(x.order_id)) + '\')">🔄</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
    }
    el.innerHTML = html;
  }

  // 🤖 a rendszer pótolta a sofőr elfelejtett gombját (GPS) — és mit szólt hozzá a sofőr
  function autoBadge(r) {
    if (!r.auto_filled) {
      // miért nem írta be a rendszer a sofőrnek (nyitott, felismert állomás)
      var sk = !r.done_at && r.match_detail && r.match_detail.auto_skip;
      if (!sk || !sk.reason) return '';
      return '<div style="margin-top:4px;"><span class="badge warn" title="' + _e(dt(sk.at)) + '">⏸ ' + _e(_t('sa.skip.' + sk.reason, sk.reason)) + '</span></div>';
    }
    var t = r.auto_ack_at
      ? (r.auto_ack_action === 'ok' ? _t('sa.autoAckOk', 'Șoferul a confirmat') : r.auto_ack_action === 'map' ? _t('sa.autoAckMap', 'Șoferul a corectat pe hartă') : _t('sa.autoAckTime', 'Șoferul a corectat ora'))
      : _t('sa.autoAckWait', 'Așteaptă confirmarea șoferului');
    var cls = r.auto_ack_at ? (r.auto_ack_action === 'ok' ? 'ok' : 'warn') : 'info';
    return '<div style="margin-top:4px;"><span class="badge ' + cls + '" title="' + _e(dt(r.auto_filled_at)) + '">🤖 ' + _e(t) + '</span></div>';
  }

  // 🔁 heti újraellenőrzés állása / ✋ kézi megerősítésre vár
  function recheckBadge(r) {
    if (['auto', 'suggested', 'unmatched'].indexOf(r.match_status) < 0) return '';
    var rc = S.recheck || { target: 150, max: 10, days: 7 };
    if (r.needs_manual) return '<div style="margin-top:4px;"><span class="badge warn" title="' + _e(_t('sa.manualTip', 'După {n} reverificări scorul tot nu a atins {t} — confirmă sau alege locul manual.', { n: rc.max, t: rc.target })) + '">✋ ' + _e(_t('sa.manual', 'Confirmare manuală')) + '</span></div>';
    if (r.match_score != null && Number(r.match_score) >= rc.target) return '';
    var base = r.recheck_at || r.matched_at;
    var next = base ? new Date(new Date(base).getTime() + rc.days * 86400000) : null;
    return '<div style="margin-top:4px;"><span class="badge info" title="' + _e(_t('sa.recheckTip', 'Se reanalizează săptămânal până la scorul {t}; după {n} încercări rămâne pentru confirmare manuală.', { n: rc.max, t: rc.target })) + '">🔁 ' + _e(_t('sa.recheck', 'Reverificare')) + ' ' + (r.recheck_count || 0) + '/' + rc.max
      + (next ? ' · ' + _e(next.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })) : '') + '</span></div>';
  }

  function renderCounts(c, queue) {
    var el = document.getElementById('saCounts'); if (!el) return;
    var html = ['auto', 'suggested', 'unmatched', 'confirmed', 'rejected'].map(function (k) {
      return '<span class="badge ' + ST[k].cls + '">' + _t(ST[k].k, ST[k].d) + ': ' + (c[k] || 0) + '</span>';
    }).join('');
    html += '<span class="badge">' + _t('sa.f.none', 'Neprocesat') + ': ' + (c.none || 0) + '</span>';
    if (c.manual) html += '<span class="badge warn" style="cursor:pointer;" onclick="StopAddress.filterManual()">✋ ' + _t('sa.f.manual', 'Așteaptă confirmare manuală') + ': ' + c.manual + '</span>';
    if (queue) html += '<span class="badge info">⏳ ' + _t('sa.queue', 'În coadă') + ': ' + queue + '</span>';
    el.innerHTML = html;
  }

  function signalsHtml(detail) {
    if (!detail || !Array.isArray(detail.signals) || !detail.signals.length) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + detail.signals.map(function (s) {
      var v = s[1];
      var cls = v > 0 ? 'ok' : v < 0 ? 'err' : 'info';
      return '<span class="badge ' + cls + '" style="font-weight:600;">' + _e(_t(SIG[s[0]] || s[0], s[0])) + (v ? ' ' + (v > 0 ? '+' : '') + v : '') + '</span>';
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
        + '<td>' + (actual ? '<div>📍 ' + _e(actual) + (r.actual_lat != null ? ' <a href="javascript:void(0)" onclick="StopAddress.map(' + r.id + ',\'actual\')" title="' + _t('sa.a.viewSat', 'Vezi pe harta satelit') + '">🛰️</a>' : '') + '</div>' : '<span class="text-muted">—</span>')
        + (r.gps_arrived_at ? '<div class="text-muted" style="font-size:12px;">⏱ ' + _e(dt(r.gps_arrived_at)) + ' – ' + _e(dt(r.gps_left_at)) + (dm != null ? ' (' + dur(dm) + ')' : '') + '</div>' : '')
        + (r.waybill_apply ? '<div style="margin-top:4px;"><span class="badge ok">📄 ' + (r.waybill_applied_at ? _t('sa.onWaybill', 'Pe foaia de parcurs') : _t('sa.wbWaiting', 'Se va pune pe foaia de parcurs')) + '</span></div>'
          : (r.wb_count ? '' : '<div class="text-muted" style="font-size:12px;margin-top:3px;">' + _t('sa.noWaybill', 'Încă fără foaie de parcurs') + '</div>'))
        + (S.open[r.id] ? signalsHtml(det) : '')
        + '</td>'
        + '<td>' + (st ? '<span class="badge ' + st.cls + '">' + _t(st.k, st.d) + '</span>' : '<span class="badge">' + _t('sa.f.none', 'Neprocesat') + '</span>')
        + (r.match_score != null ? '<div class="text-muted" style="font-size:12px;margin-top:3px;">' + _e(r.match_score) + ' ' + _t('sa.points', 'pct') + '</div>' : '')
        + (r.match_source === 'retry' ? '<div style="margin-top:3px;"><span class="badge info" title="' + _t('sa.retryTip', 'Locația anterioară a fost respinsă — sistemul a găsit una nouă și a scris-o pe foaia de parcurs') + '">🔁 ' + _t('sa.retry', 'Locație nouă după respingere') + '</span></div>' : '')
        + autoBadge(r) + recheckBadge(r) + '</td>'
        + '<td style="white-space:nowrap;">'
        + ((r.match_status === 'auto' || r.match_status === 'suggested') ? '<button class="btn ok" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'confirm\')" title="' + _t('sa.a.confirm', 'Acceptă') + '">✓</button> ' : '')
        + (r.match_status !== 'rejected' && r.match_status ? '<button class="btn danger" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'reject\')" title="' + _t('sa.a.reject', 'Respinge') + '">✕</button> ' : '')
        + (r.actual_address && r.match_status !== 'rejected' ? (r.waybill_apply
            ? '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'unapply\')" title="' + _t('sa.a.unapply', 'Scoate de pe foaia de parcurs (restaurează adresa planificată)') + '">↩</button> '
            : '<button class="btn" style="padding:5px 10px;" onclick="StopAddress.decide(' + r.id + ',\'apply\')" title="' + _t('sa.a.apply', 'Pune pe foaia de parcurs') + '">📄</button> ') : '')
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.toggle(' + r.id + ')" title="' + _t('sa.a.details', 'Detalii / alt candidat') + '">' + (S.open[r.id] ? '▾' : '▸') + '</button> '
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.map(' + r.id + ')" title="' + _t('sa.a.map', 'Alege pe hartă (unde a fost camionul)') + '">🗺️</button> '
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.edit(' + r.id + ')" title="' + _t('sa.a.edit', 'Adresă manuală') + '">✏️</button> '
        + '<button class="btn ghost" style="padding:5px 10px;" onclick="StopAddress.rerun(\'' + _e(r.order_id) + '\')" title="' + _t('sa.a.rerun', 'Recalculează cursa') + '">🔄</button>'
        + '</td></tr>';
      if (S.open[r.id]) {
        h += '<tr><td colspan="5" style="background:rgba(99,102,241,0.05);">'
          + '<div style="font-weight:700;margin-bottom:6px;">' + _t('sa.cands', 'Candidați din traseul GPS') + '</div>'
          + (r.match_status !== 'auto' && r.match_status !== 'confirmed' && cands.length > 4 ? '<div class="text-muted" style="font-size:12px;margin-bottom:6px;">' + _t('sa.lowHint', 'Siguranță scăzută — afișăm mai mulți candidați, inclusiv staționări mai scurte (min. 8 min).') + '</div>' : '')
          + (cands.length ? cands.map(function (c, i) {
            var m = mins(c.from, c.to);
            return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.25);">'
              + '<span class="badge info">' + _e(c.score) + ' ' + _t('sa.points', 'pct') + '</span>'
              + (c.short ? '<span class="badge warn">' + _t('sa.shortStop', 'staționare scurtă') + '</span>' : '')
              + (c.rest === 'daily' ? '<span class="badge warn">🛏️ ' + _t('sa.restDaily', 'odihnă zilnică') + '</span>' : c.rest === 'break' ? '<span class="badge warn">☕ ' + _t('sa.restBreak', 'pauză') + '</span>' : '')
              + (c.hop ? '<span class="badge info">➡️ ' + _t('sa.afterRest', 'prima oprire după odihnă') + '</span>' : '')
              + '<span style="flex:1;min-width:200px;">📍 ' + _e(c.address || (c.lat + ', ' + c.lng)) + ' <a href="javascript:void(0)" onclick="StopAddress.map(' + r.id + ',' + i + ')" title="' + _t('sa.a.viewSat', 'Vezi pe harta satelit') + '">🛰️</a></span>'
              + '<span class="text-muted" style="font-size:12px;">⏱ ' + _e(dt(c.from)) + ' – ' + _e(dt(c.to)) + (m != null ? ' (' + dur(m) + ')' : '') + '</span>'
              + '<button class="btn" style="padding:4px 10px;" onclick="StopAddress.pick(' + r.id + ',' + i + ')">' + _t('sa.a.pick', 'Alege') + '</button>'
              + '</div>';
          }).join('') : '<div class="text-muted">' + _t('sa.noCands', 'Nu s-a găsit nicio staționare potrivită (min. 20 min) în perioada cursei.') + '</div>')
          + '<div style="margin-top:8px;"><button class="btn primary" style="padding:6px 12px;" onclick="StopAddress.map(' + r.id + ')">🗺️ ' + _t('sa.a.mapLong', 'Alege pe hartă — unde a fost camionul în ziua respectivă') + '</button></div>'
          + '</td></tr>';
      }
    });
    body.innerHTML = h + '</tbody></table>';
  }

  function decide(id, action, extra) {
    var a = Object.assign({ stop_id: id, action: action }, extra || {});
    gas('stopMatchDecide', [a]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      if (action === 'apply') _toast(r.total_waybills ? _t('sa.applied', 'Pus pe foile de parcurs') + ': ' + r.waybills : _t('sa.appliedLater', 'Se va pune pe foaia de parcurs când aceasta este trimisă'));
      else if (action === 'reject') {
        _toast(_t('sa.rejectedMore', 'Respins — căutăm o locație nouă și, dacă o găsim, o scriem și pe foaia de parcurs (cu coordonate); dacă nu apare niciuna potrivită, alege pe hartă.'));
        S.open[id] = true;
        setTimeout(function () { if (document.getElementById('saBody')) reload(); }, 20000);
      }
      else if (r.total_waybills) _toast(_t('sa.savedWb', 'Salvat și pus pe foaia de parcurs') + ': ' + (r.waybills || 0));
      else _toast(_t('sa.savedWbLater', 'Salvat — se va pune pe foaia de parcurs când aceasta este trimisă'));
      reload();
    });
  }

  // ── Térképes kiválasztás: a jármű adott napi útvonala + megállói ──
  var M = { stopId: null, map: null, layers: null, data: null, pick: null };
  function decodePl(str) {
    var idx = 0, lat = 0, lng = 0, out = [], f = 1e6;
    str = String(str || '');
    while (idx < str.length) {
      var b, sh = 0, r = 0;
      do { b = str.charCodeAt(idx++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20 && idx < str.length);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1);
      sh = 0; r = 0;
      do { b = str.charCodeAt(idx++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20 && idx < str.length);
      lng += (r & 1) ? ~(r >> 1) : (r >> 1);
      out.push([lat / f, lng / f]);
    }
    return out;
  }
  function ensureMapModal() {
    var el = document.getElementById('saMapModal');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'modal-back';
    el.id = 'saMapModal';
    el.style.zIndex = '1100';   // a fuvar-adatlap fölött is
    el.innerHTML = '<div class="modal glass vs-light-surface" style="width:min(1000px,100%);max-height:94vh;display:flex;flex-direction:column;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<div id="saMapTitle" style="font-weight:800;flex:1;min-width:200px;"></div>'
      + '<button class="btn ghost" onclick="StopAddress.mapDay(-1)">‹</button>'
      + '<select class="select" id="saMapDay" style="width:auto;" onchange="StopAddress.mapLoad(this.value)"></select>'
      + '<button class="btn ghost" onclick="StopAddress.mapDay(1)">›</button>'
      + '<button class="btn ghost" onclick="StopAddress.mapWhole()" title="' + _t('sa.mapWhole', 'Tot traseul zilei') + '">⤢</button>'
      + '<button class="btn" onclick="StopAddress.mapClose()">✕</button>'
      + '</div>'
      + '<div id="saMapInfo" class="text-muted" style="font-size:12px;"></div>'
      + '<div id="saMapCanvas" style="height:min(62vh,560px);border-radius:12px;overflow:hidden;"></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;" class="text-muted">'
      + '<span>━ ' + _t('sa.mapRoute', 'traseul camionului') + '</span>'
      + '<span>🟠 ' + _t('sa.mapStop', 'staționare (click pentru alegere)') + '</span>'
      + '<span>🟢 ' + _t('sa.mapChosen', 'Locul ales') + '</span>'
      + '<span>🔵 ' + _t('sa.mapCand', 'candidat propus') + '</span>'
      + '<span>⚪ ' + _t('sa.mapRejected', 'loc respins') + '</span>'
      + '<span>👆 ' + _t('sa.mapAny', 'sau click oriunde pe hartă') + '</span>'
      + '</div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el) StopAddress.mapClose(); });
    if (!document.getElementById('saMapCss')) {
      var css = document.createElement('style'); css.id = 'saMapCss';
      css.textContent = '.sa-poi-lbl{background:#ffffff;color:#1e1b4b;border:1px solid #7c3aed;font-weight:600;font-size:11px;padding:1px 5px;box-shadow:0 1px 3px rgba(0,0,0,.35);}'
        + '.sa-poi-lbl:before{display:none;}'
        + '.sa-near{margin-top:6px;font-size:12px;line-height:1.45;max-height:170px;overflow:auto;color:#0f172a;}'
        + '.sa-near .text-muted{color:#475569 !important;}'
        + '.sa-near-h{font-weight:700;margin-top:4px;color:#1e293b;}';
      document.head.appendChild(css);
    }
    return el;
  }
  function mapRender(d) {
    if (typeof L === 'undefined') { document.getElementById('saMapCanvas').innerHTML = '<div style="padding:20px;">Leaflet lipsă</div>'; return; }
    if (!M.map) {
      M.map = L.map('saMapCanvas', { zoomControl: true });
      // csak műholdas réteg (Esri World Imagery) — így az épületek, rámpák, udvarok is látszanak
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxNativeZoom: 19, maxZoom: 20 }).addTo(M.map);
      // hibrid nézet (mint a Google Térkép): utak + utcanevek + település-/helynevek a műholdkép fölött
      var roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 19, maxZoom: 20, opacity: 0.9 });
      var places = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 19, maxZoom: 20 });
      var labels = L.layerGroup([roads, places]).addTo(M.map);
      var ov = {}; ov[_t('sa.mapLabels', 'Străzi și denumiri')] = labels;
      L.control.layers(null, ov, { collapsed: false, position: 'topright' }).addTo(M.map);
      L.control.scale({ imperial: false }).addTo(M.map);
      M.layers = L.layerGroup().addTo(M.map);
      M.near = L.layerGroup().addTo(M.map);   // a kijelölt pont körüli cégnevek
      M.map.on('click', function (e) { mapPickAt(e.latlng.lat, e.latlng.lng, null, null); });
    }
    M.layers.clearLayers(); M.near.clearLayers(); M.nearSeq = (M.nearSeq || 0) + 1;
    var bounds = [];
    (d.lines || []).forEach(function (ln) {
      var ll = decodePl(ln.p); if (ll.length < 2) return;
      L.polyline(ll, { color: '#ffffff', weight: 7, opacity: 0.9, interactive: false }).addTo(M.layers);
      L.polyline(ll, { color: ln.k === 'r' ? '#fde047' : '#22d3ee', weight: 4, opacity: 0.95, interactive: false }).addTo(M.layers);
      bounds = bounds.concat(ll);
    });
    (d.candidates || []).forEach(function (c) {
      if (c.lat == null) return;
      L.circleMarker([c.lat, c.lng], { radius: 9, color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 0.85 })
        .addTo(M.layers).on('click', function (ev) { L.DomEvent.stopPropagation(ev); mapPickAt(c.lat, c.lng, c.from, c.to, c.address); });
    });
    (d.stops || []).forEach(function (s) {
      L.circleMarker([s.lat, s.lng], { radius: 7, color: '#c2410c', weight: 2, fillColor: '#f97316', fillOpacity: 0.9 })
        .addTo(M.layers).bindTooltip(dt(s.from) + ' – ' + dt(s.to) + ' (' + dur(s.min) + ')')
        .on('click', function (ev) { L.DomEvent.stopPropagation(ev); mapPickAt(s.lat, s.lng, s.from, s.to); });
      bounds.push([s.lat, s.lng]);
    });
    var act = null;
    if (d.actual && d.actual.rejected) {
      L.circleMarker([d.actual.lat, d.actual.lng], { radius: 8, color: '#475569', weight: 2, fillColor: '#e2e8f0', fillOpacity: 0.9 })
        .addTo(M.layers).bindTooltip(_t('sa.mapRejected', 'loc respins'));
    } else if (d.actual) {
      // a (automatikusan vagy kézzel) kiválasztott pont — zöld, felül
      act = L.circleMarker([d.actual.lat, d.actual.lng], { radius: 11, color: '#ffffff', weight: 3, fillColor: '#16a34a', fillOpacity: 0.95 }).addTo(M.layers);
      act.bindPopup('<div style="min-width:200px;"><b>✓ ' + _e(_t('sa.mapChosen', 'Locul ales')) + '</b><br>📍 ' + _e(d.actual.address || (d.actual.lat + ', ' + d.actual.lng))
        + (d.actual.from ? '<br><span class="text-muted" style="font-size:12px;">⏱ ' + _e(dt(d.actual.from)) + ' – ' + _e(dt(d.actual.to)) + '</span>' : '') + NEAR_BOX + '</div>');
      bounds.push([d.actual.lat, d.actual.lng]);
    }
    var f = M.focus, fp = null;
    if (f === 'actual' && d.actual) fp = [d.actual.lat, d.actual.lng];
    else if (typeof f === 'number' && M.focusCand && M.focusCand.lat != null) fp = [M.focusCand.lat, M.focusCand.lng];
    else if (M.autoFocus) {
      // megnyitáskor egyből a találatra: kiválasztott pont → legjobb jelölt → teljes nap
      if (d.actual && !d.actual.rejected) { fp = [d.actual.lat, d.actual.lng]; f = 'actual'; }
      else {
        var c0 = (d.candidates || []).find(function (c) { return c.lat != null; });
        if (c0) fp = [c0.lat, c0.lng];
        else if (d.actual) fp = [d.actual.lat, d.actual.lng];
      }
    }
    M.autoFocus = false;
    if (fp) M.map.setView(fp, 17);
    else if (bounds.length) M.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    else M.map.setView([45.9, 24.9], 6);
    if (act) act.on('popupopen', function () { loadNearby(d.actual.lat, d.actual.lng, act.getPopup()); });
    if (fp && f === 'actual' && act) setTimeout(function () { act.openPopup(); }, 150);
    else if (fp) loadNearby(fp[0], fp[1], null);
    setTimeout(function () { M.map.invalidateSize(); }, 50);
  }
  var NEAR_BOX = '<!--near--><div class="sa-near"></div><!--/near-->';
  function nearHtml(inner) { return '<!--near--><div class="sa-near">' + inner + '</div><!--/near-->'; }
  // a kijelölt pont körüli cégek + utcák (szerveren OSM-ből): feliratok a térképen + lista a buborékban
  function loadNearby(lat, lng, popup) {
    var seq = M.nearSeq = (M.nearSeq || 0) + 1;
    // a buborék tartalmát szövegként cseréljük (a Leaflet update() a régi tartalmat írná vissza)
    var setBox = function (inner) {
      if (!popup || !popup.getContent) return;
      var c = popup.getContent();
      if (typeof c !== 'string' || c.indexOf('<!--near-->') < 0) return;
      popup.setContent(c.replace(/<!--near-->[\s\S]*<!--\/near-->/, nearHtml(inner)));
    };
    setBox('<span class="text-muted">⏳ ' + _e(_t('sa.nearLoading', 'Firme și străzi din apropiere…')) + '</span>');
    gas('stopMatchNearby', [{ lat: lat, lng: lng }]).then(function (r) {
      if (seq !== M.nearSeq || !M.map) return;
      M.near.clearLayers();
      var places = (r && r.ok && r.places) || [], streets = (r && r.ok && r.streets) || [];
      places.slice(0, 15).forEach(function (p) {
        var lbl = p.name + (p.street ? ' · ' + p.street : '');
        L.circleMarker([p.lat, p.lng], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#7c3aed', fillOpacity: 1 })
          .addTo(M.near)
          .bindTooltip(_e(p.name), { permanent: true, interactive: true, direction: 'right', offset: [6, 0], className: 'sa-poi-lbl' })
          .on('click', function (ev) { L.DomEvent.stopPropagation(ev); mapPickAt(p.lat, p.lng, null, null, lbl, true); });
      });
      if (!r || !r.ok || r.available === false) { setBox('<span class="text-muted">' + _e(_t('sa.nearNone', 'Lista firmelor din apropiere nu este disponibilă acum.')) + '</span>'); }
      else {
        var h = '';
        if (places.length) h += '<div class="sa-near-h">🏢 ' + _e(_t('sa.nearFirms', 'Firme în apropiere')) + '</div>'
          + places.slice(0, 8).map(function (p) { return '<div>' + _e(p.name) + (p.street ? ' <span class="text-muted">· ' + _e(p.street) + '</span>' : '') + ' <span class="text-muted">' + p.dist + ' m</span></div>'; }).join('');
        if (streets.length) h += '<div class="sa-near-h">🛣️ ' + _e(_t('sa.nearStreets', 'Străzi')) + '</div>'
          + '<div>' + streets.slice(0, 5).map(function (x) { return _e(x.name) + ' <span class="text-muted">' + x.dist + ' m</span>'; }).join(' · ') + '</div>';
        setBox(h || '<span class="text-muted">' + _e(_t('sa.nearEmpty', 'Nu sunt firme marcate pe hartă în apropiere.')) + '</span>');
      }
    });
  }
  function mapPickAt(lat, lng, from, to, addr, keepNear) {
    M.pick = { lat: lat, lng: lng, from: from, to: to };
    var html = '<div style="min-width:200px;">'
      + (addr ? '<div style="margin-bottom:4px;">📍 ' + _e(addr) + '</div>' : '<div style="margin-bottom:4px;">📍 ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '</div>')
      + (from ? '<div class="text-muted" style="font-size:12px;margin-bottom:6px;">⏱ ' + _e(dt(from)) + ' – ' + _e(dt(to)) + '</div>' : '')
      + '<button class="btn primary" style="padding:5px 12px;" onclick="StopAddress.mapConfirm()">✓ ' + _t('sa.mapUse', 'Aici a fost') + '</button>'
      + (keepNear ? '' : NEAR_BOX) + '</div>';
    var pp = L.popup({ maxWidth: 320 }).setLatLng([lat, lng]).setContent(html).openOn(M.map);
    if (!keepNear) loadNearby(lat, lng, pp);
  }
  function mapLoad(day, at) {
    var info = document.getElementById('saMapInfo');
    info.textContent = _t('sa.loading', 'Se încarcă…');
    if (day && M.data && day !== M.data.day) { M.focus = null; M.autoFocus = false; }   // kézi napváltás: a teljes nap látszik
    gas('stopMatchTrack', [{ stop_id: M.stopId, day: day || null, at: at || null, focus_actual: M.focus === 'actual' || (M.autoFocus && M.focus == null) }]).then(function (d) {
      if (!d || !d.ok) { info.textContent = (d && d.err) || 'Eroare'; return; }
      M.data = d;
      var sel = document.getElementById('saMapDay');
      var days = (d.days || []).slice();
      if (days.indexOf(d.day) < 0) days.push(d.day);
      days.sort();
      sel.innerHTML = days.map(function (x) { return '<option value="' + x + '"' + (x === d.day ? ' selected' : '') + '>' + x + (x === d.center ? ' ★' : '') + '</option>'; }).join('');
      document.getElementById('saMapTitle').textContent = (d.planned.kind === 'pickup' ? '⬆️ ' : '⬇️ ') + (d.planned.loc || '') + (d.planned.firma ? ' · ' + d.planned.firma : '') + ' — ' + (d.plate || '') + ' · ' + (d.fuvar_no || '');
      info.textContent = (d.lines && d.lines.length ? '' : _t('sa.mapNoGps', 'Nu există date GPS pentru această zi.') + ' ')
        + _t('sa.mapHint', 'Alege o staționare (portocaliu), un candidat (albastru) sau click oriunde pe hartă, apoi „Aici a fost".');
      mapRender(d);
    });
  }

  var StopAddress = {
    load: function () { if (shell()) reload(); },
    sec: function (k) { S.secOpen[k] = !S.secOpen[k]; if (k === 'acc') renderAcc(); else renderDev(); },
    accRun: function () {
      gas('stopMatchAccuracyRun', []).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        if (S.acc) { S.acc.running = true; renderAcc(); }
        setTimeout(loadAcc, 60000);
      });
    },
    devFilter: function (st) { S.devStatus = st; loadDev(); },
    filterManual: function () { S.status = 'manual'; var e = document.getElementById('saStatus'); if (e) e.value = 'manual'; reload(); },
    devRecheck: function (oid) {
      gas('routeDeviationRecheck', [{ order_id: oid }]).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        _toast(_t('sa.devQueued', 'Reverificare pornită'));
        setTimeout(loadDev, 15000);
      });
    },
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
    saveSettings: function () {
      var au = document.getElementById('saAuto'), mn = document.getElementById('saMin');
      var ae = document.getElementById('saAutoEv');
      var v = { auto_apply: !!(au && au.checked), min_score: parseInt(mn && mn.value, 10) || 80, auto_events: !!(ae && ae.checked) };
      if (v.auto_apply && !window.confirm(_t('sa.autoConfirm', 'Adresele recunoscute peste pragul ales vor fi puse automat pe foile de parcurs (și pe cele deja trimise). Continui?'))) return;
      gas('stopMatchSettingsSave', [v]).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        S.setTouched = false;
        _toast(_t('sa.saved', 'Salvat'));
        reload();
      });
    },
    applyBulk: function () {
      readFilters();
      if (!window.confirm(_t('sa.applyBulkConfirm', 'Pun adresele confirmate din perioada selectată pe foile de parcurs?'))) return;
      gas('stopMatchApplyBulk', [{ from: S.from, to: S.to }]).then(function (r) {
        if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
        _toast(_t('sa.applied', 'Pus pe foile de parcurs') + ': ' + r.waybills + ' · ' + r.points + ' ' + _t('sa.pointsWb', 'puncte'));
        reload();
      });
    },
    // focus: 'actual' (a kiválasztott pont) | jelölt-index | üres (teljes nap)
    map: function (id, focus) {
      M.stopId = id; M.pick = null; M.focus = (focus === undefined ? null : focus); M.focusCand = null; M.autoFocus = true;
      if (typeof focus === 'number') {
        var r = S.rows.find(function (x) { return x.id === id; });
        var cands = (r && r.match_detail && Array.isArray(r.match_detail.candidates)) ? r.match_detail.candidates : [];
        M.focusCand = cands[focus] || null;
      }
      var el = ensureMapModal();
      el.classList.add('open');
      mapLoad(null, M.focusCand ? M.focusCand.from : null);
    },
    mapLoad: mapLoad,
    mapDay: function (delta) {
      var sel = document.getElementById('saMapDay'); if (!sel) return;
      var i = sel.selectedIndex + delta;
      if (i < 0 || i >= sel.options.length) return;
      sel.selectedIndex = i; mapLoad(sel.value);
    },
    mapWhole: function () {
      if (!M.map || !M.data) return;
      var b = [];
      (M.data.lines || []).forEach(function (ln) { b = b.concat(decodePl(ln.p)); });
      (M.data.stops || []).forEach(function (s) { b.push([s.lat, s.lng]); });
      if (M.data.actual) b.push([M.data.actual.lat, M.data.actual.lng]);
      if (b.length) M.map.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
    },
    mapClose: function () { var el = document.getElementById('saMapModal'); if (el) el.classList.remove('open'); if (M.map) M.map.closePopup(); },
    mapConfirm: function () {
      if (!M.pick) return;
      var id = M.stopId, p = M.pick;
      StopAddress.mapClose();
      decide(id, 'map', { lat: p.lat, lng: p.lng, from: p.from || null, to: p.to || null });
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
