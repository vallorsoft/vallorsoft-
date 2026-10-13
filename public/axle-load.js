// ============================================================
//  public/axle-load.js — ⚖️ Tengelyterhelés-kalkulátor (rakodási terv)
//  Önálló menüpont (Flotta → Tengelyterhelés). KIZÁRÓLAG a kézzel
//  bevitt adatokból dolgozik: jármű-méretek + üres tengelyterhelések
//  + rakomány-blokkok (súly, kezdőpozíció, hossz).
//
//  Számítás (két emelőkar-egyensúly):
//   1) pótkocsi: a blokk súlypontja a királycsaptól d-re →
//      tengelycsoportra w·d/L, királycsapra w − w·d/L
//   2) vontató: a királycsap-terhelés a nyeregszerkezet helye szerint
//      oszlik → kormányzott: K·c/W, hajtott: K·(W−c)/W
//  + üres tengelyterhelések; ellenőrzés a (szerkeszthető) határokkal.
//
//  Szerver/DB nincs: a beállítások és a blokkok a böngészőben
//  maradnak (localStorage, csak kényelmi célból). BECSLÉS — a
//  mérlegelést nem helyettesíti.
// ============================================================
(function (root) {
  'use strict';

  // ─── Alapértékek (szerkeszthetők a felületen) ───────────────
  var DEFAULT_CFG = {
    steer0: 5.8,      // üres szerelvény: kormányzott tengely (t)
    drive0: 3.7,      // üres szerelvény: hajtott tengely (t)
    trailer0: 5.2,    // üres szerelvény: pótkocsi-tengelycsoport (t)
    wheelbase: 3.8,   // vontató tengelytáv: kormányzott → hajtott (m)
    fifthOffset: 0.6, // nyeregszerkezet a hajtott tengely ELŐTT (m)
    kingpinFront: 1.6,// pótkocsi homlokfal → királycsap (m)
    kingpinAxle: 7.7, // királycsap → pótkocsi-tengelycsoport közepe (m)
    bedLength: 13.6,  // rakfelület hossza (m)
    limSteer: 8.0,    // kormányzott tengely határ (t)
    limDrive: 11.5,   // hajtott tengely határ (t) — EU 96/53
    limTrailer: 24.0, // pótkocsi hármas tengelycsoport (t)
    limGross: 40.0,   // össztömeg (t)
    minDrivePct: 25   // hajtott tengely min. az össztömeg %-ában
  };
  var DEFAULT_ITEMS = [];

  function num(v, fb) {
    var n = (typeof v === 'string') ? parseFloat(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  // ─── Számoló motor (tiszta függvény — Jest is ezt teszteli) ──
  function compute(cfgIn, itemsIn) {
    var c = {};
    Object.keys(DEFAULT_CFG).forEach(function (k) { c[k] = num(cfgIn && cfgIn[k], DEFAULT_CFG[k]); });
    var items = Array.isArray(itemsIn) ? itemsIn : [];
    var warnings = [];
    if (!(c.wheelbase > 0) || !(c.kingpinAxle > 0)) {
      return { ok: false, err: 'geometry', warnings: warnings };
    }
    if (c.fifthOffset < 0 || c.fifthOffset > c.wheelbase) warnings.push({ key: 'fifth' });

    var cargo = 0, kp = 0, trl = 0, moment = 0;
    var placed = [];
    items.forEach(function (it, idx) {
      var w = num(it && it.weight, 0);
      var s = num(it && it.start, 0);
      var l = num(it && it.length, 0);
      if (!(w > 0)) return;
      if (l < 0) l = 0;
      var x = s + l / 2;                       // súlypont a homlokfaltól
      var d = x - c.kingpinFront;              // királycsaptól hátrafelé
      var tShare = w * d / c.kingpinAxle;
      var kShare = w - tShare;
      cargo += w; trl += tShare; kp += kShare; moment += w * x;
      if (s < 0 || s + l > c.bedLength + 1e-9) warnings.push({ key: 'outside', idx: idx });
      placed.push({ idx: idx, weight: w, start: s, length: l, center: x });
    });

    if (cargo > 0 && moment / cargo > c.kingpinFront + c.kingpinAxle) warnings.push({ key: 'behindAxle' });

    var steer = c.steer0 + kp * c.fifthOffset / c.wheelbase;
    var drive = c.drive0 + kp * (c.wheelbase - c.fifthOffset) / c.wheelbase;
    var trailer = c.trailer0 + trl;
    var gross = steer + drive + trailer;
    var drivePct = gross > 0 ? drive / gross * 100 : 0;
    if (steer < 0 || drive < 0 || trailer < 0) warnings.push({ key: 'negative' });

    function chk(key, value, limit, isMin) {
      var status;
      if (isMin) status = value >= limit ? 'ok' : 'over';
      else status = value > limit + 1e-9 ? 'over' : (value >= limit * 0.95 ? 'warn' : 'ok');
      return { key: key, value: value, limit: limit, pct: limit > 0 ? value / limit * 100 : 0, status: status, isMin: !!isMin };
    }
    var checks = [
      chk('steer', steer, c.limSteer),
      chk('drive', drive, c.limDrive),
      chk('trailer', trailer, c.limTrailer),
      chk('gross', gross, c.limGross),
      chk('drivePct', drivePct, c.minDrivePct, true)
    ];
    var worst = checks.some(function (x) { return x.status === 'over'; }) ? 'over'
      : (checks.some(function (x) { return x.status === 'warn'; }) ? 'warn' : 'ok');

    return {
      ok: true, cfg: c, steer: steer, drive: drive, trailer: trailer, gross: gross,
      cargo: cargo, kingpin: kp, drivePct: drivePct,
      cargoCenter: cargo > 0 ? moment / cargo : null,
      checks: checks, status: worst, warnings: warnings, placed: placed
    };
  }

  // Sávokba osztás a rajzhoz (egymást hosszban átfedő blokkok külön sorba)
  function assignLanes(placed) {
    var lanes = [];
    var sorted = placed.slice().sort(function (a, b) { return a.start - b.start; });
    var out = {};
    sorted.forEach(function (p) {
      var li = 0;
      while (li < lanes.length && lanes[li] > p.start + 1e-9) li++;
      lanes[li] = p.start + p.length;
      out[p.idx] = li;
    });
    return { laneOf: out, count: Math.max(1, lanes.length) };
  }

  var api = { compute: compute, assignLanes: assignLanes, DEFAULT_CFG: DEFAULT_CFG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AxleLoad = api;

  // ═══════════════════════ FELÜLET ═══════════════════════════
  var t = function (k, fb) { return (root.I18N && root.I18N.t) ? root.I18N.t(k, fb) : (fb || k); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); };
  var f2 = function (n) { return Number.isFinite(n) ? n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; };
  var COLORS = ['#f6711e', '#0d9488', '#6366f1', '#e11d48', '#ca8a04', '#2563eb', '#16a34a', '#a855f7'];
  var LS_KEY = 'vs-axle-plan';

  var S = { cfg: Object.assign({}, DEFAULT_CFG), items: DEFAULT_ITEMS.slice(), cfgOpen: false, boxId: null };

  function load() {
    try {
      var raw = root.localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.cfg) Object.keys(DEFAULT_CFG).forEach(function (k) { if (d.cfg[k] != null) S.cfg[k] = num(d.cfg[k], DEFAULT_CFG[k]); });
      if (d && Array.isArray(d.items)) S.items = d.items.slice(0, 40).map(function (it) {
        return { label: String(it.label || '').slice(0, 40), weight: num(it.weight, 0), start: num(it.start, 0), length: num(it.length, 1) };
      });
    } catch (e) { /* üres / blokkolt tár — alapértékekkel megy */ }
  }
  function save() {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify({ cfg: S.cfg, items: S.items })); } catch (e) {}
  }

  var CFG_FIELDS = [
    { grp: 'axl.grpEmpty', keys: [['steer0', 'axl.f.steer0'], ['drive0', 'axl.f.drive0'], ['trailer0', 'axl.f.trailer0']] },
    { grp: 'axl.grpGeo', keys: [['wheelbase', 'axl.f.wheelbase'], ['fifthOffset', 'axl.f.fifthOffset'], ['kingpinFront', 'axl.f.kingpinFront'], ['kingpinAxle', 'axl.f.kingpinAxle'], ['bedLength', 'axl.f.bedLength']] },
    { grp: 'axl.grpLimits', keys: [['limSteer', 'axl.f.limSteer'], ['limDrive', 'axl.f.limDrive'], ['limTrailer', 'axl.f.limTrailer'], ['limGross', 'axl.f.limGross'], ['minDrivePct', 'axl.f.minDrivePct']] }
  ];

  function mount(boxId) {
    S.boxId = boxId;
    var box = document.getElementById(boxId);
    if (!box) return;
    load();
    var cfgHtml = CFG_FIELDS.map(function (g) {
      return '<div class="axl-cfg-grp"><div class="axl-cfg-h">' + esc(t(g.grp)) + '</div><div class="axl-cfg-grid">' +
        g.keys.map(function (kv) {
          return '<label class="axl-fld"><span>' + esc(t(kv[1])) + '</span><input class="input" type="number" step="0.01" inputmode="decimal" data-axl-cfg="' + kv[0] + '" value="' + esc(S.cfg[kv[0]]) + '"></label>';
        }).join('') + '</div></div>';
    }).join('');

    box.innerHTML =
      '<div class="axl">' +
        '<div class="h-title">⚖️ ' + esc(t('axl.title')) + '</div>' +
        '<div class="axl-note">' + esc(t('axl.note')) + '</div>' +
        '<div id="axlResult"></div>' +
        '<div class="glass axl-card"><div id="axlDrawing" class="axl-drawing"></div></div>' +
        '<div class="glass axl-card">' +
          '<div class="axl-card-h"><span>📦 ' + esc(t('axl.items')) + '</span>' +
            '<span class="axl-actions"><button class="btn primary" type="button" onclick="AxleLoadPage.addItem()">➕ ' + esc(t('axl.addItem')) + '</button>' +
            '<button class="btn ghost" type="button" onclick="AxleLoadPage.clearItems()">🗑 ' + esc(t('axl.clear')) + '</button></span></div>' +
          '<div id="axlItems"></div>' +
        '</div>' +
        '<div class="glass axl-card">' +
          '<div class="axl-card-h axl-click" onclick="AxleLoadPage.toggleCfg()"><span>🚛 ' + esc(t('axl.vehicle')) + '</span><span id="axlCfgChev">' + (S.cfgOpen ? '▾' : '▸') + '</span></div>' +
          '<div id="axlCfg" style="' + (S.cfgOpen ? '' : 'display:none') + '">' +
            '<div class="axl-hint">' + esc(t('axl.vehicleHint')) + '</div>' + cfgHtml +
            '<div class="axl-actions" style="margin-top:10px"><button class="btn ghost" type="button" onclick="AxleLoadPage.resetCfg()">↺ ' + esc(t('axl.resetCfg')) + '</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    box.querySelectorAll('[data-axl-cfg]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var v = num(inp.value, NaN);
        if (Number.isFinite(v)) { S.cfg[inp.getAttribute('data-axl-cfg')] = v; save(); refresh(); }
      });
    });
    renderItems();
    refresh();
  }

  function renderItems() {
    var el = document.getElementById('axlItems');
    if (!el) return;
    if (!S.items.length) { el.innerHTML = '<div class="axl-empty">' + esc(t('axl.noItems')) + '</div>'; return; }
    el.innerHTML = S.items.map(function (it, i) {
      return '<div class="axl-item" style="border-left-color:' + COLORS[i % COLORS.length] + '">' +
        '<span class="axl-item-n" style="background:' + COLORS[i % COLORS.length] + '">' + (i + 1) + '</span>' +
        '<label class="axl-fld"><span>' + esc(t('axl.f.label')) + '</span><input class="input" type="text" maxlength="40" data-axl-i="' + i + '" data-k="label" value="' + esc(it.label) + '"></label>' +
        '<label class="axl-fld"><span>' + esc(t('axl.f.weight')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="weight" value="' + esc(it.weight) + '"></label>' +
        '<label class="axl-fld"><span>' + esc(t('axl.f.start')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="start" value="' + esc(it.start) + '"></label>' +
        '<label class="axl-fld"><span>' + esc(t('axl.f.length')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="length" value="' + esc(it.length) + '"></label>' +
        '<button class="btn ghost axl-del" type="button" title="' + esc(t('axl.del')) + '" onclick="AxleLoadPage.delItem(' + i + ')">✕</button>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-axl-i]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-axl-i')), k = inp.getAttribute('data-k');
        if (!S.items[i]) return;
        if (k === 'label') S.items[i].label = inp.value.slice(0, 40);
        else { var v = num(inp.value, NaN); if (!Number.isFinite(v)) return; S.items[i][k] = v; }
        save(); refresh();
      });
    });
  }

  function refresh() {
    var r = compute(S.cfg, S.items);
    var resEl = document.getElementById('axlResult');
    var drEl = document.getElementById('axlDrawing');
    if (!resEl || !drEl) return;
    if (!r.ok) { resEl.innerHTML = '<div class="axl-banner over">' + esc(t('axl.errGeo')) + '</div>'; drEl.innerHTML = ''; return; }

    var NAMES = { steer: 'axl.r.steer', drive: 'axl.r.drive', trailer: 'axl.r.trailer', gross: 'axl.r.gross', drivePct: 'axl.r.drivePct' };
    var cards = r.checks.map(function (ch) {
      var isPct = ch.key === 'drivePct';
      var val = isPct ? f2(ch.value) + ' %' : f2(ch.value) + ' t';
      var lim = isPct ? '≥ ' + f2(ch.limit) + ' %' : '≤ ' + f2(ch.limit) + ' t';
      var bar = isPct ? Math.min(100, ch.value / 50 * 100) : Math.min(100, ch.pct);
      return '<div class="axl-kpi ' + ch.status + '">' +
        '<div class="axl-kpi-l">' + esc(t(NAMES[ch.key])) + '</div>' +
        '<div class="axl-kpi-v">' + val + '</div>' +
        '<div class="axl-kpi-bar"><span style="width:' + bar.toFixed(1) + '%"></span></div>' +
        '<div class="axl-kpi-s">' + esc(t('axl.r.limit')) + ' ' + lim + (isPct ? '' : ' · ' + f2(ch.pct) + ' %') + '</div>' +
      '</div>';
    }).join('');

    var msgs = [];
    r.checks.forEach(function (ch) {
      if (ch.status === 'over') msgs.push(t(ch.isMin ? 'axl.w.drivePctLow' : 'axl.w.over').replace('{name}', t(NAMES[ch.key])));
    });
    var seen = {};
    r.warnings.forEach(function (w) {
      var txt = t('axl.w.' + w.key);
      if (w.idx != null) txt = txt.replace('{n}', String(w.idx + 1));
      if (!seen[txt]) { seen[txt] = 1; msgs.push(txt); }
    });
    var banner = r.status === 'ok' && !r.warnings.length
      ? '<div class="axl-banner ok">✅ ' + esc(t('axl.allOk')) + '</div>'
      : '<div class="axl-banner ' + (r.status === 'over' ? 'over' : 'warn') + '">' + msgs.map(function (m) { return '⚠️ ' + esc(m); }).join('<br>') + (msgs.length ? '' : '⚠️ ' + esc(t('axl.nearLimit'))) + '</div>';

    var info = '<div class="axl-info">' + esc(t('axl.r.cargo')) + ': <b>' + f2(r.cargo) + ' t</b> · ' + esc(t('axl.r.kingpin')) + ': <b>' + f2(r.kingpin) + ' t</b>' +
      (r.cargoCenter != null ? ' · ' + esc(t('axl.r.center')) + ': <b>' + f2(r.cargoCenter) + ' m</b>' : '') + '</div>';

    resEl.innerHTML = banner + '<div class="axl-kpis">' + cards + '</div>' + info;
    drEl.innerHTML = drawSvg(r);
  }

  // Oldalnézet (méretarányos, vízszintesen méterben)
  function drawSvg(r) {
    var c = r.cfg;
    var VW = 1000, PAD = 20;
    // Koordináták méterben: 0 = vontató eleje
    var frontAxle = 1.3;
    var driveAxle = frontAxle + c.wheelbase;
    var fifth = driveAxle - c.fifthOffset;
    var trailerFront = fifth - c.kingpinFront;
    var trailerAxle = fifth + c.kingpinAxle;
    var trailerEnd = trailerFront + c.bedLength;
    var totalM = Math.max(trailerEnd, trailerAxle + 1.5) + 0.3;
    var sx = (VW - 2 * PAD) / totalM;
    var X = function (m) { return (PAD + m * sx).toFixed(1); };
    var lanes = assignLanes(r.placed);
    var bedTop = 40, bedBot = 150, laneH = (bedBot - bedTop) / lanes.count;
    var wheelY = 178, R = 15;
    var s = '';
    // vontató
    s += '<rect x="' + X(0.2) + '" y="70" width="' + (2.1 * sx).toFixed(1) + '" height="95" rx="10" class="axl-cab"/>';
    s += '<rect x="' + X(0.2) + '" y="150" width="' + ((driveAxle + 1.0 - 0.2) * sx).toFixed(1) + '" height="14" rx="3" class="axl-chassis"/>';
    // pótkocsi rakfelület
    s += '<rect x="' + X(trailerFront) + '" y="' + bedTop + '" width="' + (c.bedLength * sx).toFixed(1) + '" height="' + (bedBot - bedTop) + '" class="axl-bed"/>';
    s += '<rect x="' + X(trailerFront) + '" y="' + bedBot + '" width="' + (c.bedLength * sx).toFixed(1) + '" height="8" class="axl-chassis"/>';
    // rakomány-blokkok
    r.placed.forEach(function (p) {
      var col = COLORS[p.idx % COLORS.length];
      var ln = lanes.laneOf[p.idx] || 0;
      var y = bedTop + ln * laneH + 2, h = laneH - 4;
      var w = Math.max(2, p.length * sx);
      var lbl = (S.items[p.idx] && S.items[p.idx].label) ? S.items[p.idx].label + ' · ' : '';
      s += '<g><title>' + esc(lbl + f2(p.weight) + ' t') + '</title><rect x="' + X(trailerFront + p.start) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4" fill="' + col + '" opacity="0.88"/>';
      if (w > 34) s += '<text x="' + (Number(X(trailerFront + p.start)) + w / 2).toFixed(1) + '" y="' + (y + h / 2 + 5).toFixed(1) + '" text-anchor="middle" class="axl-blk-t">' + esc(f2(p.weight).replace(/,00$/, '')) + ' t</text>';
      s += '</g>';
    });
    // királycsap
    s += '<polygon points="' + X(fifth) + ',' + (bedBot + 8) + ' ' + (Number(X(fifth)) - 7) + ',' + (bedBot + 20) + ' ' + (Number(X(fifth)) + 7) + ',' + (bedBot + 20) + '" class="axl-kp"/>';
    // tengelyek + terhelések
    function axle(m, load, st, triple) {
      var out = '';
      var offs = triple ? [-1.31, 0, 1.31] : [0];
      offs.forEach(function (o) { out += '<circle cx="' + X(m + o) + '" cy="' + wheelY + '" r="' + R + '" class="axl-wheel"/>'; });
      out += '<text x="' + X(m) + '" y="' + (wheelY + R + 22) + '" text-anchor="middle" class="axl-load ' + st + '">' + f2(load) + ' t</text>';
      return out;
    }
    var stOf = function (k) { var ch = r.checks.filter(function (x) { return x.key === k; })[0]; return ch ? ch.status : 'ok'; };
    s += axle(frontAxle, r.steer, stOf('steer'));
    s += axle(driveAxle, r.drive, stOf('drive'));
    s += axle(trailerAxle, r.trailer, stOf('trailer'), true);
    // méter-skála a rakfelület fölött
    for (var m = 0; m <= c.bedLength + 1e-9; m += 1) {
      s += '<line x1="' + X(trailerFront + m) + '" y1="' + (bedTop - 6) + '" x2="' + X(trailerFront + m) + '" y2="' + bedTop + '" class="axl-tick"/>';
      if (m % 2 === 0) s += '<text x="' + X(trailerFront + m) + '" y="' + (bedTop - 10) + '" text-anchor="middle" class="axl-tick-t">' + m + '</text>';
    }
    return '<svg viewBox="0 0 ' + VW + ' 230" class="axl-svg" role="img" aria-label="' + esc(t('axl.title')) + '">' + s + '</svg>';
  }

  root.AxleLoadPage = {
    mount: mount,
    addItem: function () {
      var last = S.items[S.items.length - 1];
      var start = last ? Math.round((num(last.start, 0) + num(last.length, 0)) * 10) / 10 : 0;
      S.items.push({ label: '', weight: 1, start: start, length: 1.2 });
      save(); renderItems(); refresh();
    },
    delItem: function (i) { S.items.splice(i, 1); save(); renderItems(); refresh(); },
    clearItems: function () {
      if (S.items.length && !root.confirm(t('axl.clearConfirm'))) return;
      S.items = []; save(); renderItems(); refresh();
    },
    toggleCfg: function () {
      S.cfgOpen = !S.cfgOpen;
      var el = document.getElementById('axlCfg'), ch = document.getElementById('axlCfgChev');
      if (el) el.style.display = S.cfgOpen ? '' : 'none';
      if (ch) ch.textContent = S.cfgOpen ? '▾' : '▸';
    },
    resetCfg: function () {
      if (!root.confirm(t('axl.resetConfirm'))) return;
      S.cfg = Object.assign({}, DEFAULT_CFG); save(); mount(S.boxId);
    }
  };
})(typeof window !== 'undefined' ? window : null);
