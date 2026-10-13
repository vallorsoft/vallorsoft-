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
//  Emelhető tengely (6×2 vontató, elöl „pusher” vagy hátul „tag”):
//   – FELEMELVE: terhelése 0, a vontató kéttámaszú tartó (mint fent).
//   – LEENGEDVE: a hátsó csoport (hajtott + emelhető) statikailag
//     határozatlan; a légrugó a nyomás-arány szerint osztja el: az
//     emelhető tengelyre s, a hajtottra 1−s rész jut. A csoport így egy
//     egyenértékű támasz a súlyozott helyen: x_g = W ± s·e
//     (e = tengelyköz, + tag / − pusher). Nyomaték a kormányzott
//     tengelyre: G = Σ(F_i·x_i) / x_g, kormányzott = ΣF − G,
//     hajtott = G·(1−s), emelhető = G·s.
//   – Az üres terhek (kormányzott0 + hajtott0, felemelt állapotban mérve)
//     egyetlen eredő erőként ugyanígy oszlanak át.
//
//  Szint / dőlés: nullpont (pl. 1,10 m a talajtól), a pótkocsi ELEJÉNEK
//  és VÉGÉNEK rakfelület-magassága → θ = atan((h_eleje − h_vége)/L_rak).
//   – Pótkocsi (merev test a királycsapon és a tengelyeken): a vízszintes
//     karok a dőléssel változnak. A rakomány súlypontja h_sp-vel a padló
//     fölött, a tengely közepe h_t-vel alatta van:
//       pótkocsi-tengelyekre jutó rész = (d·cosθ + h_sp·sinθ) / (L·cosθ − h_t·sinθ)
//     Ez önmagában kicsi (1°-nál pár cm), és eleje-fel dőlésnél HÁTRA tol.
//   – Hármas tengely (több méteren tartja a pótkocsit): ferde vázban a
//     tengelyek rugója nem egyformán nyomódik. Az i. tengely (eltolás e_i
//     a csoport közepétől) a csoport-átlaghoz képest Δh_i = −(h_eleje−h_vége)·e_i/L_rak
//     magasan van → terhe F_i = F/3 − k_t·Δh_i (k_t = t/cm). A csoport
//     tartópontja e = ΣF_i·e_i / ΣF_i-vel eltolódik; a pótkocsi nyomatéka
//     a királycsapra megmarad: F' = F·L/(L+e), a különbség a királycsapra
//     (és onnan a hajtottra + kormányzottra) kerül. Eleje fel → e hátra →
//     több a vontatón; eleje le → e előre → a hármas tengely visz többet.
//   – Vontató: ha az eleje a nullpont fölött van, a hajtott tengely
//     légrugója emeli a nyerget (Δ cm). Leengedett emelhető tengelynél a
//     magasabbra fújt hajtott rugó átveszi a terhet az emelhetőtől:
//       emelhető = alap − k·Δ,  hajtott = (M − emelhető·x_e) / W,
//       kormányzott = ΣF − hajtott − emelhető   (k = t/cm, állítható).
//     Két tengelyes vontatón (nincs második tengely a csoportban) a
//     magasítás statikailag nem tud terhet átrakni a hajtottra.
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
    kingpinFront: 1.69,// pótkocsi homlokfal → királycsap (m) — Schmitz S.CS: 1690 mm
    kingpinAxle: 7.7, // királycsap → középső pótkocsi-tengely (tengelytáv, m) — szabvány 7700 mm
    bedLength: 13.62, // rakfelület hossza (m) — szabvány 13 620 mm
    tridemSpacing: 1.31, // hármas tengely: tengelyköz (m) — szabvány 1310 / 1310 mm
    limSteer: 8.0,    // kormányzott tengely határ (t)
    limDrive: 11.5,   // hajtott tengely határ (t) — EU 96/53
    limTrailer: 24.0, // pótkocsi hármas tengelycsoport (t)
    limGross: 40.0,   // össztömeg (t)
    minDrivePct: 25,  // hajtott tengely min. az össztömeg %-ában
    liftType: 0,      // emelhető tengely: 0 = nincs, 1 = hajtott ELŐTT (pusher), 2 = hajtott MÖGÖTT (tag)
    liftDown: 1,      // 1 = leengedve (terhel), 0 = felemelve
    liftOffset: 1.35, // emelhető ↔ hajtott tengely távolsága (m)
    liftShare: 40,    // leengedve: a csoport-teher hány %-a jut az emelhetőre
    limLift: 7.5,     // emelhető tengely határ (t)
    limGroup: 19.0,   // hajtott + emelhető csoport határ (t) — EU 96/53, 1,3–1,8 m tengelyköz
    refHeight: 1.1,   // nullpont / szint a talajtól (m)
    frontHeight: 1.1, // pótkocsi ELEJE: rakfelület magassága a talajtól (m)
    rearHeight: 1.1,  // pótkocsi VÉGE: rakfelület magassága a talajtól (m)
    cargoCg: 1.0,     // rakomány súlypontja a rakfelület fölött (m)
    liftStiff: 0.2,   // magasítás → teher-átadás emelhető → hajtott (t / cm)
    tridemStiff: 0.5, // pótkocsi hármas tengely: rugómerevség tengelyenként (t / cm)
    wheelR: 0.5       // pótkocsi-kerék sugara (m) — a tengely magassága
  };
  var DEFAULT_ITEMS = [];

  function num(v, fb) {
    var n = (typeof v === 'string') ? parseFloat(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  // ─── Számoló motor (tiszta függvény — Jest is ezt teszteli) ──
  function compute(cfgIn, itemsIn, opts) {
    var c = {};
    Object.keys(DEFAULT_CFG).forEach(function (k) { c[k] = num(cfgIn && cfgIn[k], DEFAULT_CFG[k]); });
    c.liftType = (c.liftType === 1 || c.liftType === 2) ? c.liftType : 0;
    c.liftDown = c.liftDown ? 1 : 0;
    var items = Array.isArray(itemsIn) ? itemsIn : [];
    var warnings = [];
    if (!(c.wheelbase > 0) || !(c.kingpinAxle > 0) || !(c.bedLength > 0)) {
      return { ok: false, err: 'geometry', warnings: warnings };
    }
    if (c.fifthOffset < 0 || c.fifthOffset > c.wheelbase) warnings.push({ key: 'fifth' });

    // ── Dőlés a magasságokból ──
    var dh = c.frontHeight - c.rearHeight;
    var theta = Math.atan2(dh, c.bedLength);
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    // A tengely közepe a padló alatt (a tengely helyén mért padló-magasságból)
    var axleU = c.kingpinFront + c.kingpinAxle;
    var bedAtAxle = c.frontHeight - dh * axleU / c.bedLength;
    var axleDepth = Math.max(0, bedAtAxle - c.wheelR);
    var leverL = c.kingpinAxle * cosT - axleDepth * sinT;   // királycsap → tengely vízszintesen
    if (!(leverL > 0)) leverL = c.kingpinAxle;
    var shift = c.cargoCg * sinT;                  // a rakomány súlypontjának vízszintes eltolódása (m, + = hátra)
    var tilt = {
      deg: theta * 180 / Math.PI, pct: dh / c.bedLength * 100, shift: shift,
      frontDev: c.frontHeight - c.refHeight, rearDev: c.rearHeight - c.refHeight
    };
    if (Math.abs(tilt.deg) > 3) warnings.push({ key: 'tilt' });

    var cargo = 0, kp = 0, trl = 0, moment = 0;
    var placed = [];
    items.forEach(function (it, idx) {
      var w = num(it && it.weight, 0);
      var s = num(it && it.start, 0);
      var l = num(it && it.length, 0);
      if (!(w > 0)) return;
      if (l < 0) l = 0;
      var x = s + l / 2;                       // súlypont a homlokfaltól
      var d = (x - c.kingpinFront) * cosT + shift;   // királycsaptól vízszintesen (dőléssel)
      var tShare = w * d / leverL;
      var kShare = w - tShare;
      cargo += w; trl += tShare; kp += kShare; moment += w * x;
      if (s < 0 || s + l > c.bedLength + 1e-9) warnings.push({ key: 'outside', idx: idx });
      placed.push({ idx: idx, weight: w, start: s, length: l, center: x });
    });

    if (cargo > 0 && (moment / cargo - c.kingpinFront) * cosT + shift > leverL) warnings.push({ key: 'behindAxle' });

    // ── Hármas tengely: a ferde váz miatt eltolódó tartópont ──
    var sp = c.tridemSpacing > 0 ? c.tridemSpacing : 1.31;
    var TRI = [-sp, 0, sp];
    var fTr = c.trailer0 + trl;
    var triLoads = TRI.map(function () { return fTr / 3; });
    var triShift = 0, kpExtra = 0;
    if (dh !== 0 && fTr > 0 && c.tridemStiff > 0) {
      var raw = TRI.map(function (off) {
        var dhCm = -dh * off / c.bedLength * 100;
        return Math.max(0, fTr / 3 - c.tridemStiff * dhCm);
      });
      var sumF = raw.reduce(function (a, b) { return a + b; }, 0);
      triShift = sumF > 0 ? raw.reduce(function (a, f, i) { return a + f * TRI[i]; }, 0) / sumF : 0;
      triShift = Math.max(-sp, Math.min(sp, triShift));
      var fTr2 = fTr * leverL / (leverL + triShift);
      kpExtra = fTr - fTr2;
      triLoads = raw.map(function (f) { return sumF > 0 ? f * fTr2 / sumF : fTr2 / 3; });
      trl -= kpExtra;
      kp += kpExtra;
    }
    tilt.triShift = triShift;
    tilt.kpExtra = kpExtra;

    // ── Vontató: nyomaték a kormányzott tengelyre ──
    var W = c.wheelbase;
    var tractorLoad = c.steer0 + c.drive0 + kp;
    var tractorMoment = c.drive0 * W + kp * (W - c.fifthOffset);
    var hasLift = c.liftType > 0;
    var liftActive = hasLift && c.liftDown === 1;
    var sh = Math.min(1, Math.max(0, c.liftShare / 100));
    var liftPos = hasLift ? W + (c.liftType === 2 ? 1 : -1) * c.liftOffset : null;
    if (hasLift && !(liftPos > 0)) warnings.push({ key: 'liftGeo' });
    var groupPos = liftActive ? W + (liftPos - W) * sh : W;
    if (!(groupPos > 0)) groupPos = W;
    var group = tractorMoment / groupPos;
    var drive = liftActive ? group * (1 - sh) : group;
    var lift = liftActive ? group * sh : 0;
    // A nyereg magasítása (eleje a nullpont fölött) a hajtott légrugóval:
    // leengedett emelhetőnél terhet ad át az emelhetőről a hajtottra.
    var raiseCm = (c.frontHeight - c.refHeight) * 100;
    var transfer = 0;
    if (liftActive && raiseCm !== 0 && liftPos > 0) {
      var lift2 = Math.min(Math.max(0, lift - c.liftStiff * raiseCm), tractorMoment / liftPos);
      transfer = lift - lift2;
      lift = lift2;
      drive = (tractorMoment - lift * liftPos) / W;
    }
    var steer = tractorLoad - drive - lift;
    tilt.raiseCm = raiseCm;
    tilt.transfer = transfer;
    var trailer = c.trailer0 + trl;
    var gross = steer + drive + lift + trailer;
    var drivePct = gross > 0 ? drive / gross * 100 : 0;
    if (steer < 0 || drive < 0 || trailer < 0) warnings.push({ key: 'negative' });

    function chk(key, value, limit, isMin) {
      var status;
      if (isMin) status = value >= limit ? 'ok' : 'over';
      else status = value > limit + 1e-9 ? 'over' : (value >= limit * 0.95 ? 'warn' : 'ok');
      return { key: key, value: value, limit: limit, pct: limit > 0 ? value / limit * 100 : 0, status: status, isMin: !!isMin };
    }
    var checks = [chk('steer', steer, c.limSteer), chk('drive', drive, c.limDrive)];
    if (liftActive) {
      checks.push(chk('lift', lift, c.limLift));
      checks.push(chk('group', drive + lift, c.limGroup));
    }
    checks.push(chk('trailer', trailer, c.limTrailer));
    checks.push(chk('gross', gross, c.limGross));
    checks.push(chk('drivePct', drivePct, c.minDrivePct, true));
    var worst = checks.some(function (x) { return x.status === 'over'; }) ? 'over'
      : (checks.some(function (x) { return x.status === 'warn'; }) ? 'warn' : 'ok');

    // Mi lenne a másik emelő-állásban? (tanács a sofőrnek)
    var other = null;
    if (hasLift && !(opts && opts.noOther)) {
      var oc = Object.assign({}, c, { liftDown: liftActive ? 0 : 1 });
      var o2 = compute(oc, items, { noOther: true });
      if (o2.ok) {
        other = { liftDown: oc.liftDown, steer: o2.steer, drive: o2.drive, lift: o2.lift, drivePct: o2.drivePct, status: o2.status };
        if (worst === 'over' && o2.status !== 'over') warnings.push({ key: liftActive ? 'tryLiftUp' : 'tryLiftDown' });
      }
    }

    return {
      ok: true, cfg: c, steer: steer, drive: drive, lift: lift, trailer: trailer, gross: gross,
      cargo: cargo, kingpin: kp, drivePct: drivePct, triLoads: triLoads, hasLift: hasLift, liftActive: liftActive, liftPos: liftPos,
      cargoCenter: cargo > 0 ? moment / cargo : null, tilt: tilt, other: other,
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
  // Rövid szám: felesleges nullák nélkül (3 / 2,4 / 13,6)
  var f1 = function (n) { return Number.isFinite(n) ? n.toLocaleString('ro-RO', { maximumFractionDigits: 2 }) : '—'; };
  var r1 = function (n) { return Math.round(n * 100) / 100; };
  var COLORS = ['#f6711e', '#0d9488', '#6366f1', '#e11d48', '#ca8a04', '#2563eb', '#16a34a', '#a855f7'];
  var LS_KEY = 'vs-axle-plan';
  var STEP = 0.5;   // ◀ ▶ mozgatás lépésköze (m)

  var S = { cfg: Object.assign({}, DEFAULT_CFG), items: DEFAULT_ITEMS.slice(), cfgOpen: false, boxId: null, editIdx: -1, resizeBound: false };

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
  function bedLen() { return num(S.cfg.bedLength, DEFAULT_CFG.bedLength); }
  function usedEnd() {
    return S.items.reduce(function (m, it) { return Math.max(m, num(it.start, 0) + num(it.length, 0)); }, 0);
  }
  function itemName(i) { var it = S.items[i]; return (it && it.label) ? it.label : t('axl.itemN').replace('{n}', String(i + 1)); }

  var CFG_FIELDS = [
    { grp: 'axl.grpEmpty', keys: [['steer0', 'axl.f.steer0'], ['drive0', 'axl.f.drive0'], ['trailer0', 'axl.f.trailer0']] },
    { grp: 'axl.grpGeo', keys: [['wheelbase', 'axl.f.wheelbase'], ['fifthOffset', 'axl.f.fifthOffset'], ['kingpinFront', 'axl.f.kingpinFront'], ['kingpinAxle', 'axl.f.kingpinAxle'], ['tridemSpacing', 'axl.f.tridemSpacing'], ['bedLength', 'axl.f.bedLength']] },
    { grp: 'axl.grpLimits', keys: [['limSteer', 'axl.f.limSteer'], ['limDrive', 'axl.f.limDrive'], ['limLift', 'axl.f.limLift'], ['limGroup', 'axl.f.limGroup'], ['limTrailer', 'axl.f.limTrailer'], ['limGross', 'axl.f.limGross'], ['minDrivePct', 'axl.f.minDrivePct']] }
  ];
  // Emelhető tengely + szint kártya mezői (mindig látszik — menet közben is állítják)
  var LIFT_FIELDS = [['liftOffset', 'axl.f.liftOffset'], ['liftShare', 'axl.f.liftShare'], ['liftStiff', 'axl.f.liftStiff']];
  var HEIGHT_FIELDS = [['refHeight', 'axl.f.refHeight'], ['frontHeight', 'axl.f.frontHeight'], ['rearHeight', 'axl.f.rearHeight'], ['cargoCg', 'axl.f.cargoCg'], ['tridemStiff', 'axl.f.tridemStiff']];
  function cfgInput(k, lbl) {
    return '<label class="axl-fld"><span>' + esc(t(lbl)) + '</span><input class="input" type="number" step="0.01" inputmode="decimal" data-axl-cfg="' + k + '" value="' + esc(S.cfg[k]) + '"></label>';
  }

  function numInput(id, val, step, extra) {
    return '<input class="input" id="' + id + '" type="number" step="' + step + '" min="0" inputmode="decimal" value="' + esc(val) + '"' + (extra || '') + '>';
  }

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
        '<div id="axlBanner"></div>' +
        '<div class="glass axl-card axl-draw-card"><div id="axlDrawing" class="axl-drawing"></div><div class="axl-legend" id="axlLegend"></div></div>' +
        '<div id="axlKpis"></div>' +
        // ── Emelhető tengely + szint ──
        '<div class="glass axl-card">' +
          '<div class="axl-card-h"><span>🛞 ' + esc(t('axl.liftTitle')) + '</span></div>' +
          '<div class="axl-fld"><span>' + esc(t('axl.f.liftType')) + '</span>' +
            '<div class="axl-seg" id="axlLiftType">' +
              [['0', 'axl.lt.none'], ['1', 'axl.lt.pusher'], ['2', 'axl.lt.tag']].map(function (o) {
                return '<button type="button" data-lt="' + o[0] + '"' + (String(S.cfg.liftType) === o[0] ? ' class="on"' : '') + '>' + esc(t(o[1])) + '</button>';
              }).join('') +
            '</div></div>' +
          '<div id="axlLiftBox" style="' + (S.cfg.liftType ? '' : 'display:none') + '">' +
            '<div class="axl-fld"><span>' + esc(t('axl.f.liftState')) + '</span>' +
              '<div class="axl-seg" id="axlLiftDown">' +
                '<button type="button" data-ld="1"' + (S.cfg.liftDown ? ' class="on"' : '') + '>⬇️ ' + esc(t('axl.ld.down')) + '</button>' +
                '<button type="button" data-ld="0"' + (S.cfg.liftDown ? '' : ' class="on"') + '>⬆️ ' + esc(t('axl.ld.up')) + '</button>' +
              '</div></div>' +
            '<div class="axl-cfg-grid">' + LIFT_FIELDS.map(function (kv) { return cfgInput(kv[0], kv[1]); }).join('') + '</div>' +
            '<div class="axl-hint">' + esc(t('axl.liftHint')) + '</div>' +
          '</div>' +
          '<div class="axl-cfg-h" style="margin-top:12px">📐 ' + esc(t('axl.heightTitle')) + '</div>' +
          '<div class="axl-cfg-grid">' + HEIGHT_FIELDS.map(function (kv) { return cfgInput(kv[0], kv[1]); }).join('') + '</div>' +
          '<div class="axl-tilt" id="axlTilt"></div>' +
          '<div class="axl-hint">' + esc(t('axl.heightHint')) + '</div>' +
        '</div>' +
        // ── Új rakomány ──
        '<div class="glass axl-card axl-add">' +
          '<div class="axl-card-h"><span>➕ ' + esc(t('axl.addTitle')) + '</span><span class="axl-free" id="axlFree"></span></div>' +
          '<div class="axl-add-grid">' +
            '<label class="axl-fld axl-big"><span>' + esc(t('axl.f.weight')) + '</span>' + numInput('axlNewW', '', '0.1', ' placeholder="ex. 9"') + '</label>' +
            '<label class="axl-fld axl-big"><span>' + esc(t('axl.f.length')) + '</span>' + numInput('axlNewL', '', '0.1', ' placeholder="ex. 2,4"') + '</label>' +
          '</div>' +
          '<div class="axl-chips" id="axlLenChips">' +
            [['1.2', 'axl.ch.pallet'], ['2.4', 'axl.ch.pallet2'], ['6.8', 'axl.ch.half'], ['13.6', 'axl.ch.full']].map(function (c) {
              return '<button type="button" class="axl-chip" data-len="' + c[0] + '">' + esc(t(c[1])) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="axl-fld"><span>' + esc(t('axl.f.place')) + '</span>' +
            '<div class="axl-seg" id="axlPlaceSeg">' +
              '<button type="button" class="on" data-place="after">' + esc(t('axl.pl.after')) + '</button>' +
              '<button type="button" data-place="front">' + esc(t('axl.pl.front')) + '</button>' +
              '<button type="button" data-place="at">' + esc(t('axl.pl.at')) + '</button>' +
            '</div>' +
            '<div id="axlAtWrap" style="display:none;margin-top:8px">' + numInput('axlNewS', '0', '0.1') + '</div>' +
          '</div>' +
          '<label class="axl-fld"><span>' + esc(t('axl.f.label')) + ' <i>(' + esc(t('axl.optional')) + ')</i></span><input class="input" id="axlNewN" type="text" maxlength="40"></label>' +
          '<button class="btn primary axl-add-btn" type="button" onclick="AxleLoadPage.addFromForm()">➕ ' + esc(t('axl.addBtn')) + '</button>' +
        '</div>' +
        // ── Lista ──
        '<div class="glass axl-card">' +
          '<div class="axl-card-h"><span>📦 ' + esc(t('axl.items')) + ' <b id="axlCount"></b></span>' +
            '<button class="btn ghost" type="button" onclick="AxleLoadPage.clearItems()">🗑 ' + esc(t('axl.clear')) + '</button></div>' +
          '<div id="axlItems"></div>' +
        '</div>' +
        // ── Jármű ──
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
    box.querySelectorAll('#axlLiftType button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.cfg.liftType = Number(b.getAttribute('data-lt'));
        box.querySelectorAll('#axlLiftType button').forEach(function (x) { x.classList.toggle('on', x === b); });
        var lb = document.getElementById('axlLiftBox'); if (lb) lb.style.display = S.cfg.liftType ? '' : 'none';
        save(); refresh();
      });
    });
    box.querySelectorAll('#axlLiftDown button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.cfg.liftDown = Number(b.getAttribute('data-ld'));
        box.querySelectorAll('#axlLiftDown button').forEach(function (x) { x.classList.toggle('on', x === b); });
        save(); refresh();
      });
    });
    box.querySelectorAll('#axlLenChips .axl-chip').forEach(function (b) {
      b.addEventListener('click', function () { var el = document.getElementById('axlNewL'); if (el) el.value = b.getAttribute('data-len'); });
    });
    box.querySelectorAll('#axlPlaceSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('#axlPlaceSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
        var w = document.getElementById('axlAtWrap'); if (w) w.style.display = b.getAttribute('data-place') === 'at' ? '' : 'none';
      });
    });
    // A rajzon blokkra koppintva → az a blokk nyílik szerkesztésre
    var dr = document.getElementById('axlDrawing');
    if (dr) dr.addEventListener('click', function (e) {
      var g = e.target && e.target.closest ? e.target.closest('[data-axl-blk]') : null;
      if (!g) return;
      S.editIdx = Number(g.getAttribute('data-axl-blk'));
      renderItems();
      var card = document.getElementById('axlItem' + S.editIdx);
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (!S.resizeBound) {
      S.resizeBound = true;
      var tm = null;
      root.addEventListener('resize', function () { clearTimeout(tm); tm = setTimeout(function () { if (document.getElementById('axlDrawing')) refresh(); }, 150); });
    }
    renderItems();
    refresh();
  }

  function renderItems() {
    var el = document.getElementById('axlItems');
    var cnt = document.getElementById('axlCount');
    if (cnt) cnt.textContent = S.items.length ? '(' + S.items.length + ')' : '';
    if (!el) return;
    if (!S.items.length) { el.innerHTML = '<div class="axl-empty">' + esc(t('axl.noItems')) + '</div>'; return; }
    el.innerHTML = S.items.map(function (it, i) {
      var col = COLORS[i % COLORS.length];
      var w = num(it.weight, 0), s = num(it.start, 0), l = num(it.length, 0);
      var open = S.editIdx === i;
      var head =
        '<div class="axl-ic-top">' +
          '<span class="axl-item-n" style="background:' + col + '">' + (i + 1) + '</span>' +
          '<div class="axl-ic-txt"><div class="axl-ic-name">' + esc(itemName(i)) + '</div>' +
            '<div class="axl-ic-sub"><b>' + f1(w) + ' t</b> · ' + f1(l) + ' m · ' + esc(t('axl.pos')) + ' ' + f1(s) + ' → ' + f1(s + l) + ' m</div></div>' +
        '</div>' +
        '<div class="axl-ic-btns">' +
          '<button type="button" class="axl-ib" title="' + esc(t('axl.moveFwd')) + '" onclick="AxleLoadPage.move(' + i + ',-1)">◀</button>' +
          '<button type="button" class="axl-ib" title="' + esc(t('axl.moveBack')) + '" onclick="AxleLoadPage.move(' + i + ',1)">▶</button>' +
          '<button type="button" class="axl-ib' + (open ? ' on' : '') + '" title="' + esc(t('axl.edit')) + '" onclick="AxleLoadPage.edit(' + i + ')">✏️</button>' +
          '<button type="button" class="axl-ib axl-ib-del" title="' + esc(t('axl.del')) + '" onclick="AxleLoadPage.delItem(' + i + ')">✕</button>' +
        '</div>';
      var body = !open ? '' :
        '<div class="axl-ic-edit">' +
          '<label class="axl-fld"><span>' + esc(t('axl.f.weight')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="weight" value="' + esc(w) + '"></label>' +
          '<label class="axl-fld"><span>' + esc(t('axl.f.length')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="length" value="' + esc(l) + '"></label>' +
          '<label class="axl-fld"><span>' + esc(t('axl.f.start')) + '</span><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-axl-i="' + i + '" data-k="start" value="' + esc(s) + '"></label>' +
          '<label class="axl-fld"><span>' + esc(t('axl.f.label')) + '</span><input class="input" type="text" maxlength="40" data-axl-i="' + i + '" data-k="label" value="' + esc(it.label) + '"></label>' +
        '</div>';
      return '<div class="axl-ic' + (open ? ' open' : '') + '" id="axlItem' + i + '" style="border-left-color:' + col + '"><div class="axl-ic-row">' + head + '</div>' + body + '</div>';
    }).join('');
    el.querySelectorAll('[data-axl-i]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-axl-i')), k = inp.getAttribute('data-k');
        if (!S.items[i]) return;
        if (k === 'label') S.items[i].label = inp.value.slice(0, 40);
        else { var v = num(inp.value, NaN); if (!Number.isFinite(v) || v < 0) return; S.items[i][k] = v; }
        save(); refresh(); updateItemSub(i);
      });
    });
  }
  // Csak a fejléc-szöveget frissíti, hogy a beviteli mező fókusza megmaradjon
  function updateItemSub(i) {
    var card = document.getElementById('axlItem' + i), it = S.items[i];
    if (!card || !it) return;
    var w = num(it.weight, 0), s = num(it.start, 0), l = num(it.length, 0);
    var nm = card.querySelector('.axl-ic-name'), sub = card.querySelector('.axl-ic-sub');
    if (nm) nm.textContent = itemName(i);
    if (sub) sub.innerHTML = '<b>' + f1(w) + ' t</b> · ' + f1(l) + ' m · ' + esc(t('axl.pos')) + ' ' + f1(s) + ' → ' + f1(s + l) + ' m';
  }

  function refresh() {
    var r = compute(S.cfg, S.items);
    var bEl = document.getElementById('axlBanner'), kEl = document.getElementById('axlKpis'), drEl = document.getElementById('axlDrawing');
    var free = document.getElementById('axlFree');
    if (free) { var fr = Math.max(0, bedLen() - usedEnd()); free.textContent = t('axl.freeLen').replace('{m}', f1(r1(fr))); }
    if (!bEl || !kEl || !drEl) return;
    if (!r.ok) { bEl.innerHTML = '<div class="axl-banner over">' + esc(t('axl.errGeo')) + '</div>'; kEl.innerHTML = ''; drEl.innerHTML = ''; return; }

    var NAMES = { steer: 'axl.r.steer', drive: 'axl.r.drive', lift: 'axl.r.lift', group: 'axl.r.group', trailer: 'axl.r.trailer', gross: 'axl.r.gross', drivePct: 'axl.r.drivePct' };
    var cards = r.checks.map(function (ch) {
      var isPct = ch.key === 'drivePct';
      var val = isPct ? f1(Math.round(ch.value * 10) / 10) + ' %' : f2(ch.value) + ' t';
      var lim = isPct ? '≥ ' + f1(ch.limit) + ' %' : '≤ ' + f1(ch.limit) + ' t';
      var bar = isPct ? Math.min(100, ch.value / 50 * 100) : Math.min(100, ch.pct);
      return '<div class="axl-kpi ' + ch.status + '">' +
        '<div class="axl-kpi-l">' + esc(t(NAMES[ch.key])) + '</div>' +
        '<div class="axl-kpi-v">' + val + '</div>' +
        '<div class="axl-kpi-bar"><span style="width:' + bar.toFixed(1) + '%"></span></div>' +
        '<div class="axl-kpi-s">' + esc(t('axl.r.limit')) + ' ' + lim + '</div>' +
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
    bEl.innerHTML = r.status === 'ok' && !r.warnings.length
      ? '<div class="axl-banner ok">✅ ' + esc(t('axl.allOk')) + '</div>'
      : '<div class="axl-banner ' + (r.status === 'over' ? 'over' : 'warn') + '">' + (msgs.length ? msgs.map(function (m) { return '⚠️ ' + esc(m); }).join('<br>') : '⚠️ ' + esc(t('axl.nearLimit'))) + '</div>';

    var info = '<div class="axl-info">' + esc(t('axl.r.cargo')) + ': <b>' + f2(r.cargo) + ' t</b> · ' + esc(t('axl.r.kingpin')) + ': <b>' + f2(r.kingpin) + ' t</b>' +
      (r.cargoCenter != null ? ' · ' + esc(t('axl.r.center')) + ': <b>' + f2(r.cargoCenter) + ' m</b>' : '') + '</div>';
    if (r.other) {
      info += '<div class="axl-info">' + esc(t(r.other.liftDown ? 'axl.r.ifDown' : 'axl.r.ifUp')) + ': ' +
        esc(t('axl.r.steer')) + ' <b>' + f2(r.other.steer) + ' t</b> · ' + esc(t('axl.r.drive')) + ' <b>' + f2(r.other.drive) + ' t</b>' +
        (r.other.liftDown ? ' · ' + esc(t('axl.r.lift')) + ' <b>' + f2(r.other.lift) + ' t</b>' : '') +
        ' · ' + esc(t('axl.r.drivePct')) + ' <b>' + f1(Math.round(r.other.drivePct * 10) / 10) + ' %</b></div>';
    }
    kEl.innerHTML = '<div class="axl-kpis">' + cards + '</div>' + info;
    var tEl = document.getElementById('axlTilt');
    if (tEl) {
      var tl = r.tilt, cm = function (m) { var v = Math.round(m * 100); return (v > 0 ? '+' : '') + v + ' cm'; };
      var dir = Math.abs(tl.deg) < 0.05 ? t('axl.tilt.level') : (tl.deg > 0 ? t('axl.tilt.frontUp') : t('axl.tilt.rearUp'));
      tEl.innerHTML = '<b>' + esc(dir) + '</b> · ' + f2(Math.abs(tl.deg)) + '° (' + f1(Math.round(Math.abs(tl.pct) * 10) / 10) + ' %)' +
        '<br>' + esc(t('axl.tilt.front')) + ' ' + cm(tl.frontDev) + ' · ' + esc(t('axl.tilt.rear')) + ' ' + cm(tl.rearDev) + ' ' + esc(t('axl.tilt.vsRef')) +
        (Math.abs(tl.shift) >= 0.005 ? '<br>' + esc(t('axl.tilt.shift')).replace('{cm}', String(Math.round(Math.abs(tl.shift) * 100))).replace('{dir}', t(tl.shift > 0 ? 'axl.tilt.back' : 'axl.tilt.fwd')) : '') +
        (Math.abs(tl.kpExtra) >= 0.005 ? '<br><b>' + esc(t(tl.kpExtra > 0 ? 'axl.tilt.triBack' : 'axl.tilt.triFwd')
            .replace('{cm}', String(Math.round(Math.abs(tl.triShift) * 100))).replace('{t}', f2(Math.abs(tl.kpExtra)))) + '</b>' +
          '<br>' + esc(t('axl.tilt.triAxles')) + ' ' + (r.triLoads || []).map(function (f) { return f2(f); }).join(' / ') + ' t' : '') +
        (Math.abs(tl.transfer) >= 0.005 ? '<br><b>' + esc(t(tl.transfer > 0 ? 'axl.tilt.toDrive' : 'axl.tilt.toLift').replace('{t}', f2(Math.abs(tl.transfer)))) + '</b>'
          : '');
    }

    var w = Math.min(900, drEl.clientWidth || 600);
    drEl.innerHTML = drawSvg(r, w);
    var lg = document.getElementById('axlLegend');
    if (lg) lg.innerHTML = S.items.length ? esc(t('axl.tapHint')) : '';
  }

  // Oldalnézet — MINDIG kifér a képernyő szélességébe (nincs vízszintes görgetés).
  // A rajz a valódi pixel-szélességre készül, így a feliratok telefonon is olvashatók.
  function drawSvg(r, W) {
    var c = r.cfg;
    var small = W < 520;
    var PAD = small ? 6 : 14;
    var fs = small ? 11 : 13;              // betűméret px
    var frontAxle = 1.3;
    var driveAxle = frontAxle + c.wheelbase;
    var fifth = driveAxle - c.fifthOffset;
    var trailerFront = fifth - c.kingpinFront;
    var trailerAxle = fifth + c.kingpinAxle;
    var trailerEnd = trailerFront + c.bedLength;
    var startM = Math.min(0, trailerFront - 0.2);
    var liftM = r.hasLift ? frontAxle + r.liftPos : null;
    var totalM = Math.max(trailerEnd, trailerAxle + 1.5) + 0.3 - startM;
    var sx = (W - 2 * PAD) / totalM;
    var X = function (m) { return PAD + (m - startM) * sx; };
    var lanes = assignLanes(r.placed);
    var bedTop = fs + 12;
    var bedH = Math.max(small ? 46 : 70, Math.min(110, lanes.count * (fs + 14)));
    var bedBot = bedTop + bedH;
    var R = Math.max(7, Math.min(15, sx * 0.48));
    var wheelY = bedBot + 10 + R;
    var H = wheelY + R + fs + 12 + (r.hasLift ? fs + 4 : 0);
    var laneH = bedH / lanes.count;
    var o = function (n) { return n.toFixed(1); };
    var s = '';
    // vontató (fülke + alváz)
    var cabTop = bedTop + bedH * 0.25;
    s += '<rect x="' + o(X(0.2)) + '" y="' + o(cabTop) + '" width="' + o(2.1 * sx) + '" height="' + o(bedBot - cabTop + 6) + '" rx="' + o(Math.min(10, sx * 0.4)) + '" class="axl-cab"/>';
    s += '<rect x="' + o(X(0.2) + 2.1 * sx * 0.55) + '" y="' + o(cabTop + 6) + '" width="' + o(2.1 * sx * 0.35) + '" height="' + o((bedBot - cabTop) * 0.3) + '" rx="3" class="axl-win"/>';
    s += '<rect x="' + o(X(0.2)) + '" y="' + o(bedBot) + '" width="' + o((Math.max(driveAxle, liftM || 0) + 1.0 - 0.2) * sx) + '" height="' + o(small ? 8 : 12) + '" rx="3" class="axl-chassis"/>';
    // pótkocsi (a dőlést felnagyítva, a királycsap körül forgatva mutatjuk)
    var visDeg = Math.max(-6, Math.min(6, r.tilt.deg * 3));
    s += '<g transform="rotate(' + visDeg.toFixed(2) + ' ' + o(X(fifth)) + ' ' + o(bedBot) + ')">';
    s += '<rect x="' + o(X(trailerFront)) + '" y="' + o(bedTop) + '" width="' + o(c.bedLength * sx) + '" height="' + o(bedH) + '" class="axl-bed"/>';
    s += '<rect x="' + o(X(trailerFront)) + '" y="' + o(bedBot) + '" width="' + o(c.bedLength * sx) + '" height="' + o(small ? 5 : 7) + '" class="axl-chassis"/>';
    // rakomány
    r.placed.forEach(function (p) {
      var col = COLORS[p.idx % COLORS.length];
      var ln = lanes.laneOf[p.idx] || 0;
      var y = bedTop + ln * laneH + 2, h = laneH - 4;
      var bw = Math.max(3, p.length * sx), bx = X(trailerFront + p.start);
      var sel = S.editIdx === p.idx;
      s += '<g data-axl-blk="' + p.idx + '" class="axl-blk"><title>' + esc(itemName(p.idx) + ' · ' + f1(p.weight) + ' t') + '</title>' +
        '<rect x="' + o(bx) + '" y="' + o(y) + '" width="' + o(bw) + '" height="' + o(h) + '" rx="4" fill="' + col + '"' + (sel ? ' stroke="#0f172a" stroke-width="2.5"' : '') + '/>';
      var lbl = f1(p.weight) + ' t';
      if (bw > lbl.length * fs * 0.62 + 4) s += '<text x="' + o(bx + bw / 2) + '" y="' + o(y + h / 2 + fs * 0.36) + '" text-anchor="middle" class="axl-blk-t" font-size="' + fs + '">' + esc(lbl) + '</text>';
      else if (bw > fs) s += '<text x="' + o(bx + bw / 2) + '" y="' + o(y + h / 2 + fs * 0.36) + '" text-anchor="middle" class="axl-blk-t" font-size="' + fs + '">' + (p.idx + 1) + '</text>';
      s += '</g>';
    });
    s += '</g>';
    if (Math.abs(r.tilt.deg) >= 0.05) {
      s += '<line x1="' + o(X(trailerFront)) + '" y1="' + o(bedBot) + '" x2="' + o(X(trailerEnd)) + '" y2="' + o(bedBot) + '" class="axl-level"/>';
      s += '<text x="' + o(X(trailerEnd) - 2) + '" y="' + o(bedTop + fs) + '" text-anchor="end" class="axl-tick-t" font-size="' + (fs - 1) + '">∠ ' + f1(Math.round(r.tilt.deg * 100) / 100) + '°</text>';
    }
    // királycsap
    var kx = X(fifth), ky = bedBot + (small ? 5 : 7);
    s += '<polygon points="' + o(kx) + ',' + o(ky) + ' ' + o(kx - 6) + ',' + o(ky + 9) + ' ' + o(kx + 6) + ',' + o(ky + 9) + '" class="axl-kp"/>';
    // tengelyek + terhelés
    var stOf = function (k) { var ch = r.checks.filter(function (x) { return x.key === k; })[0]; return ch ? ch.status : 'ok'; };
    function axle(m, load, st, triple, raised, row) {
      var out = '';
      var cy = raised ? wheelY - R * 0.9 : wheelY;
      (triple ? [-c.tridemSpacing, 0, c.tridemSpacing] : [0]).forEach(function (d) { out += '<circle cx="' + o(X(m + d)) + '" cy="' + o(cy) + '" r="' + o(raised ? R * 0.85 : R) + '" class="axl-wheel' + (raised ? ' axl-raised' : '') + '"/>'; });
      var lx = Math.min(Math.max(X(m), PAD + fs * 2), W - PAD - fs * 2);
      var txt = raised ? '⬆ 0 t' : f1(Math.round(load * 100) / 100) + ' t';
      out += '<text x="' + o(lx) + '" y="' + o(wheelY + R + fs + 4 + (row ? fs + 4 : 0)) + '" text-anchor="middle" class="axl-load ' + st + '" font-size="' + (fs + 1) + '">' + txt + '</text>';
      return out;
    }
    s += axle(frontAxle, r.steer, stOf('steer'));
    s += axle(driveAxle, r.drive, stOf('drive'));
    if (r.hasLift) s += axle(liftM, r.lift, r.liftActive ? stOf('lift') : 'ok', false, !r.liftActive, true);
    s += axle(trailerAxle, r.trailer, stOf('trailer'), true);
    // méterskála
    var stepM = sx * 2 < fs * 2.2 ? 4 : 2;
    for (var m = 0; m <= c.bedLength + 1e-9; m += 1) {
      s += '<line x1="' + o(X(trailerFront + m)) + '" y1="' + o(bedTop - 4) + '" x2="' + o(X(trailerFront + m)) + '" y2="' + o(bedTop) + '" class="axl-tick"/>';
      if (m % stepM === 0) s += '<text x="' + o(X(trailerFront + m)) + '" y="' + o(bedTop - 7) + '" text-anchor="middle" class="axl-tick-t" font-size="' + (fs - 2) + '">' + m + '</text>';
    }
    return '<svg width="' + W + '" height="' + o(H) + '" viewBox="0 0 ' + W + ' ' + o(H) + '" class="axl-svg" role="img" aria-label="' + esc(t('axl.title')) + '">' + s + '</svg>';
  }

  function place(mode, len, at) {
    if (mode === 'front') {
      // a homlokfalhoz kerül, a többit hátrébb tolja
      S.items.forEach(function (it) { it.start = r1(num(it.start, 0) + len); });
      return 0;
    }
    if (mode === 'at') return Math.max(0, r1(num(at, 0)));
    return r1(usedEnd());
  }

  root.AxleLoadPage = {
    mount: mount,
    addFromForm: function () {
      var w = num((document.getElementById('axlNewW') || {}).value, NaN);
      var l = num((document.getElementById('axlNewL') || {}).value, NaN);
      if (!(w > 0)) { if (root.toast) root.toast(t('axl.needWeight'), 'err'); else root.alert(t('axl.needWeight')); return; }
      if (!(l > 0)) { if (root.toast) root.toast(t('axl.needLength'), 'err'); else root.alert(t('axl.needLength')); return; }
      var onBtn = document.querySelector('#axlPlaceSeg button.on');
      var mode = onBtn ? onBtn.getAttribute('data-place') : 'after';
      var start = place(mode, l, (document.getElementById('axlNewS') || {}).value);
      var nm = String((document.getElementById('axlNewN') || {}).value || '').slice(0, 40);
      var item = { label: nm, weight: w, start: start, length: l };
      if (mode === 'front') S.items.unshift(item); else S.items.push(item);
      S.editIdx = -1;
      ['axlNewW', 'axlNewL', 'axlNewN'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
      save(); renderItems(); refresh();
    },
    move: function (i, dir) {
      var it = S.items[i]; if (!it) return;
      var maxStart = Math.max(0, bedLen() - num(it.length, 0));
      it.start = Math.min(maxStart, Math.max(0, r1(num(it.start, 0) + dir * STEP)));
      save(); renderItems(); refresh();
    },
    edit: function (i) { S.editIdx = S.editIdx === i ? -1 : i; renderItems(); refresh(); },
    delItem: function (i) { S.items.splice(i, 1); S.editIdx = -1; save(); renderItems(); refresh(); },
    clearItems: function () {
      if (S.items.length && !root.confirm(t('axl.clearConfirm'))) return;
      S.items = []; S.editIdx = -1; save(); renderItems(); refresh();
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
