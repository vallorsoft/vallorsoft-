// ============================================================
//  VallorSoft — lib/stopMatch.js
//  Tényleges fel-/lerakási hely felismerése a GPS-ből (tiszta motor, DB nélkül).
//
//  Elv: a fuvar tervezett állomásai (sorrendben) és a jármű GPS-állásai
//  (időrendben) közötti LEGJOBB, SORRENDTARTÓ párosítás (dinamikus
//  programozás). Egy állomás-jelölt pontszáma független jelekből jön:
//    - helymemória (korábban elfogadott rakodóhely)      — nagyon erős
//    - a tervezett cég geokódolt helye közel              — erős
//    - távolság a tervezett településtől / név-egyezés    — közepes
//    - úton kívül áll (udvar/rámpa), előtte manőverezés   — közepes
//    - ipari/raktár környezet (OSM), nem kút/parkoló      — gyenge
//    - tervezett dátum, állás-hossz                        — gyenge
//    - kizárás: saját telephely, tankolás az állás alatt   — mínusz
//  A sofőr gombnyomása CSAK felső korlát: a hely nem kezdődhet jóval a
//  „kész" gomb UTÁN (a késői gombnyomás nem baj, csak a korai nem lehet).
//  Determinisztikus és magyarázható — minden jel a `signals`-ban.
// ============================================================
const gt = require('./gpsTrack');

const MIN_DWELL_SEC = Math.max(5, parseInt(process.env.STOP_MATCH_MIN_MINUTES, 10) || 20) * 60;
const SITE_RADIUS_M = 400;          // egy telephelyen belüli állások összevonása
const SITE_GAP_SEC = 25 * 60;       // ...ha ennél rövidebb mozgás választja el őket
const MIN_ASSIGN = 25;              // ennél kisebb pontszámú jelöltet nem rendelünk hozzá
const AUTO_SCORE = 60, AUTO_MARGIN = 12, SUGGEST_SCORE = 30;
const BUTTON_SLACK_SEC = 45 * 60;   // a „kész" gomb előtt legalább ennyivel el kellett kezdődnie
// Ismert rakodóhelyen (helymemória / a fuvar már felismert, azonos helyű állomása / a tervezett
// cég pontos helye) a rövid állás is jelölt: ha ott megállt és utána továbbment, ott rakodott.
const SITE_STOP_MIN_SEC = Math.max(1, parseInt(process.env.STOP_MATCH_SITE_MIN_MINUTES, 10) || 2) * 60;
const SITE_STOP_RADIUS_M = 300;     // ennyin belül az ismert ponttól
const SITE_STOP_MERGE_SEC = 15 * 60; // kapunál várakozás + rámpa: egy látogatás, ha ennyin belül
const PREV_SLACK_SEC = 30 * 60;      // az előző állomás „kész" ideje előtt véget ért állás nem lehet ez az állomás
const PRESS_NEAR_SEC = 5 * 60;       // a sofőr gombnyomásához ennyin belüli GPS-pont számít
const PRESS_CLUSTER_M = 300;         // két gombnyomás-hely ennyin belül = ugyanaz a hely

// ── Szöveg ──────────────────────────────────────────────────
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const NOISE = new Set(['str', 'strada', 'bd', 'bdul', 'bulevardul', 'calea', 'aleea', 'sat', 'jud', 'judetul', 'com', 'comuna',
  'oras', 'municipiul', 'nr', 'sc', 'srl', 'sa', 'kft', 'gmbh', 'zrt', 'romania', 'ro', 'hu', 'hungary', 'magyarorszag', 'ungaria',
  'germany', 'deutschland', 'germania', 'zona', 'industriala', 'cod', 'cp', 'utca', 'ut', 'the', 'and', 'de', 'la']);
// a tervezett címből a település-jelölt szavak (zaj, irányítószám, házszám nélkül)
function placeTokens(loc) {
  return norm(loc).split(' ').filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
}
function firmaTokens(f) {
  return norm(f).split(' ').filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
}
// a tervezett cím első értelmes vesszős darabja → geokódolható település-szöveg
function cityQuery(loc) {
  const parts = String(loc || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const n = norm(p);
    if (!n || /^\d+$/.test(n.replace(/ /g, ''))) continue;
    if (/^(str|strada|bd|bdul|calea|aleea|nr)\b/.test(n)) continue;
    return p;
  }
  return parts[0] || '';
}

// ── Idő ─────────────────────────────────────────────────────
const _hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: gt.TZ, hour: '2-digit', hourCycle: 'h23' });
function localHour(sec) { return parseInt(_hourFmt.format(new Date(sec * 1000)), 10) % 24; }
function localDay(sec) { return gt.localDay(sec * 1000); }
function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
function toSec(v) { if (!v) return null; const t = Date.parse(v); return isFinite(t) ? Math.floor(t / 1000) : null; }

// ── Geometria ───────────────────────────────────────────────
function dist(aLat, aLng, bLat, bLng) { return gt.distM([0, aLat, aLng], [0, bLat, bLng]); }
// pont – szakasz távolság (m), kis távolságokra síkközelítés
function segDist(lat, lng, a, b) {
  const k = Math.cos(lat * Math.PI / 180) * 111320, m = 110540;
  const px = lng * k, py = lat * m, ax = a[1] * k, ay = a[0] * m, bx = b[1] * k, by = b[0] * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
}
// roadLines: [[ [lat,lng], ... ], ...] — az úthálózatra illesztett vonalak
function roadDistance(lat, lng, roadLines) {
  if (!roadLines || !roadLines.length) return null;
  let best = Infinity;
  const box = 0.02; // ~2 km előszűrés
  for (const line of roadLines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (Math.min(a[0], b[0]) > lat + box || Math.max(a[0], b[0]) < lat - box) continue;
      if (Math.min(a[1], b[1]) > lng + box || Math.max(a[1], b[1]) < lng - box) continue;
      const d = segDist(lat, lng, a, b);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? null : Math.round(best);
}
function median(arr) { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

// ── 1) Jelöltek: GPS-állások → telephely-látogatások ─────────
// Pihenő-jelleg: napi pihenő (≥ 8 óra) vagy vezetési szünet (30–75 perc, többnyire
// gyújtás kikapcsolva / közút mellett). Ezek után a sofőr gyakran csak pár km-t megy
// tovább a valódi rakodóhelyre — ott néha csak 2 percet áll.
const REST_DAILY_SEC = 8 * 3600;
const BREAK_MIN_SEC = 30 * 60, BREAK_MAX_SEC = 75 * 60;
const FOLLOW_DAILY_SEC = 6 * 3600;    // napi pihenő után ennyi időn belüli következő állás
const FOLLOW_BREAK_SEC = 3 * 3600;    // szünet után
const FOLLOW_KM = 30;                 // a pihenőtől legfeljebb ennyi km-re
const FOLLOW_MIN_KM = 0.4;            // ennél közelebb = ugyanaz a hely (kigördülés a parkolóból)
const HOP_MIN_SEC = 2 * 60;           // a pihenő utáni rövid állás alsó határa

function _restKind(c) {
  if (c.dur >= REST_DAILY_SEC || (c.night > 0.6 && c.dur >= 6 * 3600)) return 'daily';
  if (c.dur >= BREAK_MIN_SEC && c.dur <= BREAK_MAX_SEC && c.maneuvers < 3
      && (c.ign_off == null || c.ign_off >= 0.5) && c.road_m != null && c.road_m < 150) return 'break';
  return null;
}

// Egy állás (st: {from,to,lat,lng,dwell,parts:[{i0,i1}]}) → jelölt-objektum
function _mkCand(pts, st, opts) {
  const la = [], ln = [];
  let ignOff = 0, ignN = 0;
  for (const p of st.parts) {
    for (let i = p.i0; i <= p.i1 && i < pts.length; i++) {
      la.push(pts[i][1]); ln.push(pts[i][2]);
      if (pts[i][4] != null) { ignN++; if (pts[i][4] === 0) ignOff++; }
    }
  }
  // középpont: az állás-pontok mediánja (a GPS-remegés kiszűrve)
  const lat = median(la) != null ? median(la) : st.lat, lng = median(ln) != null ? median(ln) : st.lng;
  // manőverezés: az érkezés előtti 20 percben, 1,5 km-en belül lassú mozgás irányváltásokkal
  let man = 0, prevDir = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] < st.from - 20 * 60) continue;
    if (p[0] > st.to) break;
    if (p[3] == null || p[3] < 1 || p[3] > 20) continue;
    if (dist(lat, lng, p[1], p[2]) > 1500) continue;
    const dir = p[8];
    if (dir != null && prevDir != null) {
      let d = Math.abs(dir - prevDir) % 360; if (d > 180) d = 360 - d;
      if (d >= 45) man++;
    }
    if (dir != null) prevDir = dir;
  }
  // éjszakai arány (22–05 óra)
  let night = 0, steps = 0;
  for (let t = st.from; t < st.to; t += 900) { steps++; const h = localHour(t); if (h >= 22 || h < 5) night++; }
  const refuel = (opts.refuels || []).some((r) => r && r.t >= st.from - 600 && r.t <= st.to + 600
    && (r.lat == null || dist(lat, lng, r.lat, r.lng) < 600));
  return {
    from: st.from, to: st.to, dur: st.to - st.from, dwell: st.dwell,
    lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5,
    day: localDay(st.from), maneuvers: man,
    night: steps ? Math.round(night / steps * 100) / 100 : 0,
    ign_off: ignN ? Math.round(ignOff / ignN * 100) / 100 : null,
    road_m: roadDistance(lat, lng, opts.roadLines),
    refuel,
    place: null,
  };
}

// Rövid (≥ 2 perces) állások egy időablakban — a detectStops 5 perces küszöbe alatt is.
// Álló pontok sora (≤ 150 m), vagy két pont közti adathiány közel azonos helyen.
function microStops(pts, fromSec, toSec, minSec) {
  const out = [], n = pts.length;
  const still = (p) => (p[3] != null ? p[3] < 5 : false) || p[4] === 0;
  let i = 0;
  while (i < n && pts[i][0] < fromSec) i++;
  while (i < n && pts[i][0] <= toSec) {
    if (!still(pts[i])) {
      const nx = pts[i + 1];
      if (nx && nx[0] - pts[i][0] >= minSec && gt.distM(pts[i], nx) < 150 && nx[0] <= toSec) {
        out.push({ from: pts[i][0], to: nx[0], lat: pts[i][1], lng: pts[i][2], dwell: nx[0] - pts[i][0], parts: [{ i0: i, i1: i }] });
      }
      i++; continue;
    }
    let j = i;
    while (j + 1 < n && still(pts[j + 1]) && gt.distM(pts[i], pts[j + 1]) < 150) j++;
    const to = j + 1 < n ? pts[j + 1][0] : pts[j][0];
    if (to - pts[i][0] >= minSec) out.push({ from: pts[i][0], to, lat: pts[i][1], lng: pts[i][2], dwell: to - pts[i][0], parts: [{ i0: i, i1: j }] });
    i = j + 1;
  }
  return out;
}

// Rövid állások ismert rakodóhelyen (sites: [{lat,lng,radius_m?}]). A már meglévő
// jelöltekkel (taken) átfedőket kihagyja; a tisztán forgalmi (úton, manőver nélküli,
// gyújtással álló, 4 percnél rövidebb) megállást nem veszi jelöltnek.
function siteStops(pts, sites, opts, taken) {
  const out = [];
  const pl = (sites || []).filter((x) => x && isFinite(Number(x.lat)) && isFinite(Number(x.lng)) && x.lat != null);
  if (!pl.length || !Array.isArray(pts) || pts.length < 2) return out;
  const atSite = (lat, lng) => pl.some((x) => dist(lat, lng, Number(x.lat), Number(x.lng))
    <= Math.max(SITE_STOP_RADIUS_M, Math.min(Number(x.radius_m) || 0, 500)));
  const ms = microStops(pts, pts[0][0], pts[pts.length - 1][0], SITE_STOP_MIN_SEC).filter((m) => atSite(m.lat, m.lng));
  const groups = [];
  for (const m of ms) {
    const g = groups[groups.length - 1];
    if (g && m.from - g.to <= SITE_STOP_MERGE_SEC && dist(g.lat, g.lng, m.lat, m.lng) < SITE_RADIUS_M) {
      g.to = Math.max(g.to, m.to); g.dwell += m.dwell; g.parts = g.parts.concat(m.parts);
    } else groups.push({ from: m.from, to: m.to, lat: m.lat, lng: m.lng, dwell: m.dwell, parts: m.parts.slice() });
  }
  for (const g of groups) {
    if ((taken || []).some((c) => c.from <= g.to && g.from <= c.to)) continue;
    const c = _mkCand(pts, g, opts);
    if (c.dwell < 4 * 60 && c.road_m != null && c.road_m < 15 && c.maneuvers === 0 && !(c.ign_off >= 0.5)) continue;
    c.atSite = true;
    out.push(c);
  }
  return out;
}

// A GPS-pont a megadott időhöz legközelebb (± PRESS_NEAR_SEC), vagy null. pts időrendben.
function pointAt(pts, sec) {
  if (!Array.isArray(pts) || !pts.length || sec == null) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] < sec) lo = mid + 1; else hi = mid; }
  let best = null;
  for (const i of [lo - 1, lo]) {
    const p = pts[i];
    if (p && Math.abs(p[0] - sec) <= PRESS_NEAR_SEC && (!best || Math.abs(p[0] - sec) < Math.abs(best[0] - sec))) best = p;
  }
  return best;
}

// Ismert hely a sofőr gombnyomásaiból: ugyanannak a helynek a többi állomásánál (sibs) a
// „kész" (ennek hiányában az „odaértem") gomb pillanatában álló kamion helye. Csak akkor
// számít, ha legalább két állomás gombnyomása ugyanott volt, vagy a gombnyomás helye
// egybeesik az állomás GPS-ből felismert helyével — egy félrenyomott (pl. parkolóban
// utólag megnyomott) gomb így nem tesz ismertté egy rossz helyet.
function pressSites(pts, sibs) {
  const marks = [];
  for (const x of sibs || []) {
    for (const v of [x.done_at, x.arrived_at]) {
      const p = pointAt(pts, toSec(v instanceof Date ? v.toISOString() : v));
      if (!p) continue;
      const still = (p[3] != null ? p[3] < 5 : false) || p[4] === 0;
      if (!still) continue;
      marks.push({ id: x.id, lat: p[1], lng: p[2],
        act: x.actual_lat != null && x.actual_lng != null ? { lat: Number(x.actual_lat), lng: Number(x.actual_lng) } : null });
      break;
    }
  }
  const out = [];
  for (const m of marks) {
    const twice = marks.some((o) => o.id !== m.id && dist(m.lat, m.lng, o.lat, o.lng) <= PRESS_CLUSTER_M);
    const agrees = m.act && dist(m.lat, m.lng, m.act.lat, m.act.lng) <= PRESS_CLUSTER_M;
    if (twice || agrees) out.push({ lat: m.lat, lng: m.lng, radius_m: 250, press: true });
  }
  return out;
}

function buildCandidates(pts, opts) {
  opts = opts || {};
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const endSec = pts[pts.length - 1][0];
  const stops = gt.detectStops(pts, endSec);
  const sites = [];
  for (const s of stops) {
    const cur = sites[sites.length - 1];
    if (cur && s.from - cur.to <= SITE_GAP_SEC && dist(cur.lat, cur.lng, s.lat, s.lng) < SITE_RADIUS_M) {
      cur.to = Math.max(cur.to, s.to); cur.dwell += Math.max(0, s.to - s.from); cur.parts.push(s);
    } else {
      sites.push({ from: s.from, to: s.to, lat: s.lat, lng: s.lng, dwell: Math.max(0, s.to - s.from), parts: [s] });
    }
  }
  let out = [];
  for (const st of sites) {
    if (st.to - st.from < (opts.minDwellSec || MIN_DWELL_SEC)) continue;
    out.push(_mkCand(pts, st, opts));
  }
  // ismert rakodóhelyen a rövid állás is jelölt
  if (opts.sitePoints && opts.sitePoints.length) {
    const sx = siteStops(pts, opts.sitePoints, opts, out);
    if (sx.length) out = out.concat(sx).sort((a, b) => a.from - b.from);
  }
  if (opts.noFollowUps) return out;
  // Pihenő után a közeli rövid állások is jelöltek (lehet, hogy ott rakodott 2 percet)
  for (const c of out) c.rest = _restKind(c);
  const hops = [];
  for (const r of out) {
    if (!r.rest) continue;
    const win = r.rest === 'daily' ? FOLLOW_DAILY_SEC : FOLLOW_BREAK_SEC;
    for (const m of microStops(pts, r.to, r.to + win, HOP_MIN_SEC)) {
      const km = dist(r.lat, r.lng, m.lat, m.lng) / 1000;
      if (km < FOLLOW_MIN_KM || km > FOLLOW_KM) continue;
      if (out.some((c) => c.from <= m.to && m.from <= c.to)) continue;            // már jelölt
      if (hops.some((h) => h.from <= m.to && m.from <= h.to)) continue;
      const h = _mkCand(pts, m, opts);
      // forgalmi megállás (lámpa, dugó) kiszűrése: az úton áll, manőverezés nélkül
      if (h.road_m != null && h.road_m < 25 && h.maneuvers < 2 && (h.ign_off == null || h.ign_off < 0.5)) continue;
      h.hop = true; h.after_rest = r.rest;
      hops.push(h);
    }
  }
  if (hops.length) out = out.concat(hops).sort((a, b) => a.from - b.from);
  // A pihenő után a közelben még megállt → valószínűleg nem a pihenő volt a rakodóhely
  for (const r of out) {
    if (!r.rest) continue;
    const win = r.rest === 'daily' ? FOLLOW_DAILY_SEC : FOLLOW_BREAK_SEC;
    const f = out.find((c) => c !== r && c.from >= r.to && c.from - r.to <= win
      && dist(r.lat, r.lng, c.lat, c.lng) / 1000 >= FOLLOW_MIN_KM && dist(r.lat, r.lng, c.lat, c.lng) / 1000 <= FOLLOW_KM);
    if (f) { r.followed = Math.round(dist(r.lat, r.lng, f.lat, f.lng) / 100) / 10; r.follow = { lat: f.lat, lng: f.lng }; }   // km
  }
  return out;
}

// Mentett hely geozónája: a megadott sugár, de legalább SAVED_ZONE_MIN_M (a telephely másik
// pontján is rakodhat), + GPS-tűrés.
const SAVED_ZONE_MIN_M = 200, SAVED_ZONE_TOL_M = 150;
function zoneM(m) { return Math.max(SAVED_ZONE_MIN_M, Number(m && m.radius_m) || 250) + SAVED_ZONE_TOL_M; }

// ── 2) Egy (állomás, jelölt) pár pontszáma + indoklás ─────────
const BAD_CAT = /^(amenity:(fuel|parking|parking_space|restaurant|fast_food|cafe|toilets)|highway:(rest_area|services|motorway|trunk|primary|secondary)|tourism:(hotel|motel)|amenity:border_control)$/;
const GOOD_CAT = /^(landuse:(industrial|commercial|retail|farmyard)|building:(warehouse|industrial|commercial|retail|manufacture|hangar)|man_made:works|shop:|office:|craft:|industrial:)/;

// A tanult súlyok csak a POZITÍV jeleket skálázzák (0,5–1,5×): ami a cég elfogadott
// döntéseiben gyakran szerepelt, többet ér; ami az elvetettekben, kevesebbet.
function _w(exp, key, v) {
  if (!(v > 0) || !exp.weights || exp.weights[key] == null) return v;
  return Math.round(v * Math.max(0.5, Math.min(1.5, exp.weights[key])));
}
// A jelölt helyének neve egyezik-e a tervezett településsel (ékezet/kisbetű-független)
function nameMatches(stop, pl) {
  if (!pl) return false;
  const toks = placeTokens(stop.loc);
  const names = [pl.city, pl.municipality].map(norm).filter(Boolean);
  return !!(toks.length && names.some((n) => toks.some((t) => n === t || n.split(' ').includes(t) || (t.length >= 5 && n.includes(t)))));
}

function _restMoved(cand, exp) {
  if (!cand || !cand.rest || cand.followed == null || !cand.follow) return false;
  const ref = (exp && (exp.firmaGeo || exp.cityGeo)) || null;
  if (!ref) return true;
  const dR = dist(cand.lat, cand.lng, ref.lat, ref.lng), dF = dist(cand.follow.lat, cand.follow.lng, ref.lat, ref.lng);
  return dF <= dR + 2000;
}

function scorePair(stop, cand, exp) {
  exp = exp || {};
  const sig = [];
  let sc = 0;
  const add = (k, v) => { v = _w(exp, k, v); if (v) { sc += v; sig.push([k, v]); } };
  // helymemória
  let memHit = false;
  for (const m of exp.memory || []) {
    if (m.lat == null) continue;
    if (dist(cand.lat, cand.lng, m.lat, m.lng) <= zoneM(m)) { memHit = true; break; }
  }
  if (memHit) add('memory', 45);
  // a cég mentett helye a tervezett település környékén (a cégnév nem egyezik / nincs megadva)
  if (!memHit) {
    for (const m of exp.saved || []) {
      if (m.lat == null) continue;
      if (dist(cand.lat, cand.lng, m.lat, m.lng) <= zoneM(m)) { add('saved_place', 25); break; }
    }
  }
  // korábban elvetett hely (ugyanennél a cégnél erősen, máshol ismétlődés esetén)
  const ftNorm = firmaTokens(stop.firma).join(' ');
  for (const b of exp.badPlaces || []) {
    if (b.lat == null || dist(cand.lat, cand.lng, b.lat, b.lng) > 250) continue;
    if (ftNorm && b.firma_norm && b.firma_norm === ftNorm) { add('rejected_before', -45); break; }
    if ((b.hits || 0) >= 2) { add('rejected_place', -20); break; }
  }
  const pl = cand.place;
  const nameHit = nameMatches(stop, pl);
  // tervezett cég helye
  if (exp.firmaGeo) {
    const d = dist(cand.lat, cand.lng, exp.firmaGeo.lat, exp.firmaGeo.lng);
    add('firma_near', d <= 300 ? 35 : d <= 1000 ? 22 : d <= 3000 ? 8 : 0);
  }
  // település — névegyezésnél a távolság nem büntet: azonos nevű települések
  // (pl. Malacky SK / BG) esetén az számít, ahol a jármű ténylegesen állt
  if (exp.cityGeo) {
    const km = dist(cand.lat, cand.lng, exp.cityGeo.lat, exp.cityGeo.lng) / 1000;
    const v = km <= 3 ? 18 : km <= 10 ? 14 : km <= 25 ? 8 : km <= 50 ? 0 : km <= 150 ? -40 : -100;
    // a saját mentett helyen sem büntet: ott a mentett pont az igazság, nem a geokódolt település
    if (v >= 0 || !(nameHit || memHit)) add('city_dist', v);
    else if (nameHit) sig.push(['homonym', 0]);   // csak jelzés: a geokódolt azonos nevű hely máshol van
  }
  if (pl) {
    if (nameHit) add('city_name', 20);
    else if (pl.county && placeTokens(stop.loc).some((t) => norm(pl.county).split(' ').includes(t))) add('county_name', 4);
    // a reverse-geokód POI-neve a tervezett cégre hasonlít
    const ft = firmaTokens(stop.firma);
    if (ft.length && pl.name && ft.some((t) => norm(pl.name).split(' ').includes(t))) add('poi_name', 20);
    const cat = (pl.category || '') + ':' + (pl.type || '');
    if (BAD_CAT.test(cat)) { if (!memHit) add('bad_place', -15); }
    else if (GOOD_CAT.test(cat)) add('industrial', 8);
  }
  // dátum — ha a hely neve / helymemória egyezik, a késés (akár másnap, harmadnap) nem büntet
  if (stop.data) {
    const dd = dayDiff(cand.day, String(stop.data).slice(0, 10));
    const ad = Math.abs(dd);
    if ((nameHit || memHit) && dd >= -1 && dd <= 3) add('date', ad === 0 ? 10 : 3);
    else add('date', ad === 0 ? 10 : ad === 1 ? 3 : ad === 2 ? -10 : -40);
  }
  // gombnyomás = felső korlát (a késői gomb nem baj)
  const done = toSec(stop.done_at);
  if (done != null) {
    if (cand.from > done + BUTTON_SLACK_SEC) add('after_button', -60);
    else if (done - cand.to <= 6 * 3600) add('before_button', 8);
  }
  // sorrend: az előző állomás kész-ideje előtt (tűréssel) véget ért állás nem ez az állomás
  // (ugyanarra a helyre többször jön → a korábbi látogatás nem a mostani rakodás)
  if (exp.prevDone != null && cand.to < exp.prevDone - PREV_SLACK_SEC) add('before_prev', -60);
  // állás jellege
  add('duration', cand.dur <= 6 * 3600 ? 6 : 0);
  // pihenő (napi / 45 perces) után a közelben még megállt → a pihenő nem a rakodóhely
  // (csak ha a következő állás legalább olyan közel van a tervezett helyhez — ha távolodott, az már a továbbút)
  if (_restMoved(cand, exp)) add(cand.rest === 'daily' ? 'rest_then_moved' : 'break_then_moved', cand.rest === 'daily' ? -35 : -25);
  // a pihenő utáni első közeli állás — rövid is lehet (2 perces lerakás)
  if (cand.hop) {
    const nearPlan = !exp.cityGeo || dist(cand.lat, cand.lng, exp.cityGeo.lat, exp.cityGeo.lng) <= 30000;
    if (nearPlan) add('after_rest', 14);
  } else if (cand.atSite) {
    // rövid megállás ismert helyen: kis levonás, hogy azonos helyen a hosszabb állás elsőbbséget kapjon
    if (cand.dwell < 15 * 60) add('short_site', -4);
  } else if (cand.dwell < 15 * 60) add('short_dwell', -10);
  add('maneuver', cand.maneuvers >= 6 ? 10 : cand.maneuvers >= 3 ? 6 : 0);
  if (cand.road_m != null) add('offroad', cand.road_m >= 120 ? 10 : cand.road_m >= 60 ? 5 : cand.road_m < 20 ? -5 : 0);
  if (cand.night > 0.6 && cand.dur > 7 * 3600) add('night_rest', -5);
  if (cand.refuel) add('refuel', -20);
  // saját telephely (kivéve, ha a tervezett hely is ott van)
  if (exp.hq && dist(cand.lat, cand.lng, exp.hq.lat, exp.hq.lng) < 600) {
    const sameAsPlan = exp.cityGeo && dist(exp.cityGeo.lat, exp.cityGeo.lng, exp.hq.lat, exp.hq.lng) < 3000;
    if (!sameAsPlan && !memHit) add('home_base', -50);
  }
  return { score: Math.round(sc), signals: sig };
}

// A cég döntéseiből tanult jel-súlyok: { signal: { accepted, rejected } } → { signal: szorzó }
// Kevés adatnál (≤ 4 döntés) semleges marad.
function weightsFromFeedback(rows) {
  const w = {};
  for (const r of rows || []) {
    const a = Number(r.accepted) || 0, x = Number(r.rejected) || 0;
    if (a + x < 5) continue;
    w[r.signal] = Math.max(0.5, Math.min(1.5, ((a + 2) / (a + x + 4)) * 2));
  }
  return w;
}

// ── 3) Sorrendtartó párosítás (DP) ──────────────────────────
// stops: tervezett sorrendben; cands: időrendben; expect: stop-index → elvárás
// Visszatér: [{ stopIdx, candIdx|null, score, margin, status, signals }]
function _strongPlace(sig) { return (sig || []).some((x) => (x[0] === 'memory' || x[0] === 'firma_near' || x[0] === 'poi_name' || x[0] === 'saved_place') && x[1] >= 20); }
function sameSite(a, b) { return norm(a.loc) === norm(b.loc) && norm(a.firma) === norm(b.firma); }
function align(stops, cands, expect) {
  const m = stops.length, n = cands.length;
  const S = stops.map((s, i) => cands.map((c) => scorePair(s, c, expect[i])));
  const NEG = -1e9;
  // dp[s] = legjobb összeg, ahol s = az utoljára használt jelölt indexe + 1 (0 = egyik sem)
  let dp = new Array(n + 1).fill(NEG); dp[0] = 0;
  const back = [];
  for (let i = 0; i < m; i++) {
    const nd = new Array(n + 1).fill(NEG), bk = new Array(n + 1).fill(null);
    for (let s = 0; s <= n; s++) {
      if (dp[s] === NEG) continue;
      if (dp[s] > nd[s]) { nd[s] = dp[s]; bk[s] = { from: s, cand: null }; }
      for (let k = 0; k < n; k++) {
        const okIdx = k + 1 > s || (k + 1 === s && i > 0 && sameSite(stops[i], stops[i - 1]));
        if (!okIdx) continue;
        const sc = S[i][k].score;
        if (sc < MIN_ASSIGN) continue;
        const v = dp[s] + sc;
        if (v > nd[k + 1]) { nd[k + 1] = v; bk[k + 1] = { from: s, cand: k }; }
      }
    }
    back.push(bk); dp = nd;
  }
  let bestS = 0;
  for (let s = 0; s <= n; s++) if (dp[s] > dp[bestS]) bestS = s;
  const pick = new Array(m).fill(null);
  for (let i = m - 1, s = bestS; i >= 0; i--) {
    const b = back[i][s];
    if (!b) break;
    pick[i] = b.cand; s = b.from;
  }
  return stops.map((st, i) => {
    const k = pick[i];
    const ranked = cands.map((c, j) => ({ j, score: S[i][j].score, signals: S[i][j].signals })).sort((a, b) => b.score - a.score);
    if (k == null) return { stopIdx: i, candIdx: null, score: ranked.length ? ranked[0].score : null, margin: null, status: 'unmatched', signals: [], ranked };
    const sc = S[i][k].score;
    const alt = ranked.find((r) => r.j !== k && !(Math.abs(cands[r.j].lat - cands[k].lat) < 0.002 && Math.abs(cands[r.j].lng - cands[k].lng) < 0.002));
    const margin = alt ? sc - alt.score : sc;
    let status = sc >= AUTO_SCORE && margin >= AUTO_MARGIN ? 'auto' : sc >= SUGGEST_SCORE ? 'suggested' : 'unmatched';
    // pihenő utáni / pihenő-gyanús hely: sosem „biztos" (a gombot sem pótoljuk belőle),
    // kivéve ha a hely ismert (helymemória) vagy a tervezett cég van ott
    if (status === 'auto' && !_strongPlace(S[i][k].signals) && (cands[k].hop || _restMoved(cands[k], expect[i]))) status = 'suggested';
    return { stopIdx: i, candIdx: status === 'unmatched' ? null : k, score: sc, margin, status, signals: S[i][k].signals, ranked };
  });
}

// ── Mentett helyek (favorite_locations) hozzárendelése egy állomáshoz ──
// memory: ez a hely az állomásé — a cégnév egyezik, VAGY a fuvarba a mentett hely
//         címe / neve került (a diszpécser a ⭐ listából választotta).
// saved : a cég többi mentett helye a tervezett település környékén (≤ SAVED_AREA_KM) —
//         ott a rövid megállás is jelölt, és a pontozásban külön (gyengébb) jel.
const SAVED_AREA_KM = 15;
function _textHit(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.includes(short);
}
function savedFor(stop, rows, cityGeo) {
  const memory = [], saved = [];
  const ft = firmaTokens(stop && stop.firma);
  for (const m of rows || []) {
    if (!m || m.lat == null || m.lng == null || !isFinite(Number(m.lat)) || !isFinite(Number(m.lng))) continue;
    const mt = firmaTokens(m.firma || m.label);
    const byFirma = ft.length && mt.length && ft.filter((t) => mt.includes(t)).length >= Math.min(2, ft.length);
    const byText = _textHit(stop && stop.loc, m.address) || _textHit(stop && stop.loc, m.label)
      || _textHit(stop && stop.firma, m.label);
    if (byFirma || byText) { memory.push(m); continue; }
    if (cityGeo && dist(Number(m.lat), Number(m.lng), cityGeo.lat, cityGeo.lng) <= SAVED_AREA_KM * 1000) saved.push(m);
  }
  return { memory, saved };
}

// ── Következtetés: a következő állomás megvan → az előző is megtörtént ──
// Ha egy több pontos fuvarnál egy KÉSŐBBI állomás megvan (GPS-találat vagy a sofőr
// gombnyomása), a kimaradt korábbi állomást is elvégezték. Megnézzük, járt-e a kamion
// a tervezett helyen (mentett hely / cég helye / település) az előző és a következő
// állomás között, és ha igen, azt a látogatást adjuk az állomásnak — javaslatként.
const INFER_SITE_M = 400, INFER_FIRMA_M = 500, INFER_CITY_M = 3000;
const INFER_GAP_SEC = 20 * 60;      // egy látogatáson belül ennyi adathiány fér el
const INFER_STILL_SEC = 60;         // ennyi állás már megállásnak számít
const INFER_PASS_BEFORE_SEC = 15 * 60;
function _visitIn(pts, i0, i1, tg, radius) {
  let best = null, run = null;
  const close = () => {
    if (!run) return;
    if (!best || run.still > best.still || (run.still === best.still && run.to - run.from > best.to - best.from)) best = run;
    run = null;
  };
  for (let i = i0; i <= i1; i++) {
    const p = pts[i];
    const d = dist(p[1], p[2], tg.lat, tg.lng);
    if (d > radius) { close(); continue; }
    if (run && p[0] - run.to > INFER_GAP_SEC) close();
    const still = (p[3] != null ? p[3] < 5 : false) || p[4] === 0;
    if (!run) run = { from: p[0], to: p[0], still: 0, la: [], ln: [], near: p, nearD: d, last: p, lastStill: false };
    else {
      const dt = p[0] - run.to;
      // állás: két egymást követő álló pont, vagy adathiány közel azonos helyen
      if ((still && run.lastStill) || (dt >= INFER_STILL_SEC && gt.distM(run.last, p) < 150)) run.still += dt;
    }
    run.to = p[0]; run.lastStill = still; run.last = p;
    if (still) { run.la.push(p[1]); run.ln.push(p[2]); }
    if (d < run.nearD) { run.near = p; run.nearD = d; }
  }
  close();
  return best;
}
// A tervezett helységben álló rövid megállások (≥ minSec összesen), a közeli darabok összevonva.
const INFER_CITY_STOP_M = 6000;       // a helység középpontjától ennyin belüli megállás számít
const INFER_CITY_STOP_SEC = 5 * 60;   // ismeretlen ponton legalább ennyi állás kell
const INFER_DAY_BEFORE = 1, INFER_DAY_AFTER = 3;   // a tervezett nap körüli ablak (nap)
function _stopsNear(pts, lo, hi, tg, radius, minSec) {
  const groups = [];
  for (const m of microStops(pts, lo, hi, 120)) {
    if (dist(m.lat, m.lng, tg.lat, tg.lng) > radius) continue;
    const g = groups[groups.length - 1];
    if (g && m.from - g.to <= SITE_STOP_MERGE_SEC && dist(g.lat, g.lng, m.lat, m.lng) < SITE_RADIUS_M) { g.to = Math.max(g.to, m.to); g.dwell += m.dwell; }
    else groups.push({ from: m.from, to: m.to, lat: m.lat, lng: m.lng, dwell: m.dwell });
  }
  return groups.filter((g) => g.dwell >= minSec);
}
// Két szabály, mindkettő csak JAVASLATOT ad, és csak akkor, ha a GPS szerint a kamion tényleg ott járt:
//  1) „a következő megvan": egy későbbi állomás megvan → a kimaradt előzőt az előző és a következő
//     állomás között keressük (mentett hely → cég helye → helység; helységnél az áthaladás is elég);
//  2) „ott járt a tervezett napon": nincs későbbi támpont (pl. az utolsó állomás), vagy a sofőr más
//     sorrendben rakodott — ha a kamion a tervezett nap körül (−1 … +3 nap) megállt a tervezett
//     helyen / helységben, a műveletet elvégezte; a megállás pontos helyét kapja az állomás.
function inferVisits(stops, res, cands, expect, pts) {
  const out = [];
  if (!Array.isArray(pts) || pts.length < 2 || !Array.isArray(stops) || !stops.length) return out;
  const ev = stops.map((s, i) => {
    const r = res && res[i];
    const c = r && r.candIdx != null ? cands[r.candIdx] : null;
    const done = toSec(s.done_at instanceof Date ? s.done_at.toISOString() : s.done_at);
    return c ? { from: c.from, to: c.to } : (done != null ? { from: done, to: done, button: true } : null);
  });
  const dayWin = (s) => {
    const t = Date.parse(String(s.data || '').slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(t)) return null;
    return { from: t / 1000 - INFER_DAY_BEFORE * 86400 - 3 * 3600, to: t / 1000 + (INFER_DAY_AFTER + 1) * 86400 };
  };
  const search = (i, lo, hi, allowPass, excludeTaken) => {
    if (!(hi > lo)) return null;
    let i0 = 0; while (i0 < pts.length && pts[i0][0] <= lo) i0++;
    let i1 = pts.length - 1; while (i1 >= 0 && pts[i1][0] >= hi) i1--;
    if (i1 < i0) return null;
    const e = (expect && expect[i]) || {};
    // más állomás már felismert látogatása nem lehet ezé (kivéve, ha ugyanaz a hely a tervben)
    const free = (a, b) => !excludeTaken || !ev.some((x, j) => x && j !== i && !x.button && x.from <= b && a <= x.to && !sameSite(stops[i], stops[j]));
    const minStill = allowPass ? INFER_STILL_SEC : 120;
    const targets = [];
    for (const m of (e.memory || []).concat(e.saved || [])) {
      if (m && m.lat != null) targets.push({ lvl: 'site', lat: Number(m.lat), lng: Number(m.lng), r: Math.max(INFER_SITE_M, Math.min(Number(m.radius_m) || 0, 500)) });
    }
    if (e.firmaGeo) targets.push({ lvl: 'firma', lat: e.firmaGeo.lat, lng: e.firmaGeo.lng, r: INFER_FIRMA_M });
    let hit = null;
    for (const lvl of ['site', 'firma']) {
      for (const tg of targets) {
        if (tg.lvl !== lvl) continue;
        const v = _visitIn(pts, i0, i1, tg, tg.r);
        if (!v || v.still < minStill || !free(v.from, v.to)) continue;
        if (!hit || v.still > hit.still) {
          hit = { lvl, stopped: true, from: v.from, to: v.to, still: v.still,
            lat: v.la.length ? median(v.la) : v.near[1], lng: v.ln.length ? median(v.ln) : v.near[2] };
        }
      }
      if (hit) return hit;
    }
    if (!e.cityGeo) return null;
    const tg = e.cityGeo;
    // a helységben a leghosszabb (de nem pihenő-hosszú) megállás pontos helye
    const atHq = (g) => e.hq && dist(g.lat, g.lng, e.hq.lat, e.hq.lng) < 600 && dist(tg.lat, tg.lng, e.hq.lat, e.hq.lng) >= 3000;
    const val = (g) => Math.min(g.dwell, 4 * 3600);
    let best = null;
    for (const g of _stopsNear(pts, lo, hi, tg, INFER_CITY_STOP_M, INFER_CITY_STOP_SEC)) {
      if (atHq(g) || !free(g.from, g.to)) continue;
      if (!best || val(g) > val(best)) best = g;
    }
    if (best) return { lvl: 'city', stopped: true, from: best.from, to: best.to, still: best.dwell, lat: best.lat, lng: best.lng };
    const v = _visitIn(pts, i0, i1, tg, INFER_CITY_M);
    if (!v || !free(v.from, v.to)) return null;
    // későbbi támpont nélkül ismeretlen ponton csak a legalább 5 perces állás számít
    const stopped = v.still >= (allowPass ? minStill : INFER_CITY_STOP_SEC);
    if (!stopped && !allowPass) return null;
    // a puszta áthaladás csak akkor számít, ha nem a következő állomásra érkezés része
    if (!stopped && hi - v.to < INFER_PASS_BEFORE_SEC) return null;
    return { lvl: 'city', stopped, from: v.from, to: v.to, still: v.still,
      lat: v.la.length ? median(v.la) : v.near[1], lng: v.ln.length ? median(v.ln) : v.near[2] };
  };
  for (let i = 0; i < stops.length; i++) {
    const r = res && res[i];
    if (!r || r.candIdx != null) continue;
    const s = stops[i];
    if (s.match_status === 'confirmed' || s.match_status === 'rejected') continue;
    let hi = null, viaButton = false;
    for (let j = i + 1; j < stops.length; j++) if (ev[j]) { hi = ev[j].from; viaButton = !!ev[j].button; break; }
    // a saját „kész" gomb felső korlát: a hely nem kezdődhet jóval utána
    const cap = ev[i] && ev[i].button ? ev[i].from + BUTTON_SLACK_SEC : Infinity;
    let lo = pts[0][0] - 1;
    for (let k = 0; k < i; k++) if (ev[k] && ev[k].to > lo) lo = ev[k].to;
    let hit = null, mode = null;
    if (hi != null) { hit = search(i, lo, Math.min(hi, cap), true, false); mode = 'next'; }
    const dw = hit ? null : dayWin(s);
    if (!hit && dw) {
      mode = 'day';
      // sorrendben (az előző állomás után), ha nincs későbbi támpont
      if (hi == null) hit = search(i, Math.max(lo, dw.from), Math.min(dw.to, cap), false, true);
      // a sofőr más sorrendben is rakodhatott → a tervezett nap körül bárhol, ami még nem másik állomásé
      if (!hit) hit = search(i, dw.from, Math.min(dw.to, cap), false, true);
    }
    if (!hit) continue;
    const base = hit.lvl === 'site' ? 30 : hit.lvl === 'firma' ? 25 : (hit.stopped ? 15 : 5);
    const lead = mode === 'day' ? ['visit_day', 20] : [viaButton ? 'next_button' : 'next_done', 25];
    const signals = [lead, [hit.lvl === 'city' ? (hit.stopped ? 'visit_city' : 'pass_city') : 'visit_site', base]];
    const o = { stopIdx: i, lat: Math.round(hit.lat * 1e5) / 1e5, lng: Math.round(hit.lng * 1e5) / 1e5, from: hit.from, to: hit.to,
      still: hit.still, level: hit.lvl, stopped: hit.stopped, mode, score: lead[1] + base, signals };
    out.push(o);
    ev[i] = { from: o.from, to: o.to };   // a következő kimaradt állomás ettől számol
  }
  return out;
}

// előzetes pontszám (reverse-geokód nélkül) — melyik jelöltnek kérjünk címet
// A geokódolt település/cég helyét itt szándékosan NEM használjuk: azonos nevű
// településnél (más országban) rossz helyre mutathat, és így a valódi állás címét
// sem kérnénk le. Csak a GPS-állás jellege, a dátum, a gomb és a memória számít.
function prescore(stops, cands, expect) {
  return cands.map((c) => Math.max(...stops.map((s, i) => {
    const e = expect[i] || {};
    return scorePair(s, c, { memory: e.memory, saved: e.saved, badPlaces: e.badPlaces, weights: e.weights, prevDone: e.prevDone }).score;
  })));
}

module.exports = {
  MIN_DWELL_SEC, MIN_ASSIGN, AUTO_SCORE, SUGGEST_SCORE,
  norm, placeTokens, firmaTokens, cityQuery, roadDistance, buildCandidates, scorePair, align, prescore, localDay,
  nameMatches, weightsFromFeedback, savedFor, inferVisits, zoneM, SAVED_ZONE_MIN_M, microStops, siteStops, sameSite, pressSites, pointAt, SITE_STOP_MIN_SEC,
};
