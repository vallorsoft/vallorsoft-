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
  const out = [];
  for (const st of sites) {
    if (st.to - st.from < MIN_DWELL_SEC) continue;
    // középpont: az állás-pontok mediánja (a GPS-remegés kiszűrve)
    const la = [], ln = [];
    let ignOff = 0, ignN = 0;
    for (const p of st.parts) {
      for (let i = p.i0; i <= p.i1 && i < pts.length; i++) {
        la.push(pts[i][1]); ln.push(pts[i][2]);
        if (pts[i][4] != null) { ignN++; if (pts[i][4] === 0) ignOff++; }
      }
    }
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
    out.push({
      from: st.from, to: st.to, dur: st.to - st.from, dwell: st.dwell,
      lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5,
      day: localDay(st.from), maneuvers: man,
      night: steps ? Math.round(night / steps * 100) / 100 : 0,
      ign_off: ignN ? Math.round(ignOff / ignN * 100) / 100 : null,
      road_m: roadDistance(lat, lng, opts.roadLines),
      refuel,
      place: null,
    });
  }
  return out;
}

// ── 2) Egy (állomás, jelölt) pár pontszáma + indoklás ─────────
const BAD_CAT = /^(amenity:(fuel|parking|parking_space|restaurant|fast_food|cafe|toilets)|highway:(rest_area|services|motorway|trunk|primary|secondary)|tourism:(hotel|motel)|amenity:border_control)$/;
const GOOD_CAT = /^(landuse:(industrial|commercial|retail|farmyard)|building:(warehouse|industrial|commercial|retail|manufacture|hangar)|man_made:works|shop:|office:|craft:|industrial:)/;

function scorePair(stop, cand, exp) {
  exp = exp || {};
  const sig = [];
  let sc = 0;
  const add = (k, v) => { if (v) { sc += v; sig.push([k, v]); } };
  // helymemória
  let memHit = false;
  for (const m of exp.memory || []) {
    if (m.lat == null) continue;
    if (dist(cand.lat, cand.lng, m.lat, m.lng) <= (m.radius_m || 250) + 100) { memHit = true; break; }
  }
  if (memHit) add('memory', 45);
  // tervezett cég helye
  if (exp.firmaGeo) {
    const d = dist(cand.lat, cand.lng, exp.firmaGeo.lat, exp.firmaGeo.lng);
    add('firma_near', d <= 300 ? 35 : d <= 1000 ? 22 : d <= 3000 ? 8 : 0);
  }
  // település
  if (exp.cityGeo) {
    const km = dist(cand.lat, cand.lng, exp.cityGeo.lat, exp.cityGeo.lng) / 1000;
    add('city_dist', km <= 3 ? 18 : km <= 10 ? 14 : km <= 25 ? 8 : km <= 50 ? 0 : km <= 150 ? -40 : -100);
  }
  const pl = cand.place;
  if (pl) {
    const toks = placeTokens(stop.loc);
    const names = [pl.city, pl.municipality].map(norm).filter(Boolean);
    if (toks.length && names.some((n) => toks.some((t) => n === t || n.split(' ').includes(t) || (t.length >= 5 && n.includes(t))))) add('city_name', 15);
    else if (pl.county && toks.some((t) => norm(pl.county).split(' ').includes(t))) add('county_name', 4);
    // a reverse-geokód POI-neve a tervezett cégre hasonlít
    const ft = firmaTokens(stop.firma);
    if (ft.length && pl.name && ft.some((t) => norm(pl.name).split(' ').includes(t))) add('poi_name', 20);
    const cat = (pl.category || '') + ':' + (pl.type || '');
    if (BAD_CAT.test(cat)) add('bad_place', -15);
    else if (GOOD_CAT.test(cat)) add('industrial', 8);
  }
  // dátum
  if (stop.data) {
    const dd = Math.abs(dayDiff(cand.day, String(stop.data).slice(0, 10)));
    add('date', dd === 0 ? 10 : dd === 1 ? 3 : dd === 2 ? -10 : -40);
  }
  // gombnyomás = felső korlát (a késői gomb nem baj)
  const done = toSec(stop.done_at);
  if (done != null) {
    if (cand.from > done + BUTTON_SLACK_SEC) add('after_button', -60);
    else if (done - cand.to <= 6 * 3600) add('before_button', 8);
  }
  // állás jellege
  add('duration', cand.dur <= 6 * 3600 ? 6 : 0);
  if (cand.dwell < 15 * 60) add('short_dwell', -10);
  add('maneuver', cand.maneuvers >= 6 ? 10 : cand.maneuvers >= 3 ? 6 : 0);
  if (cand.road_m != null) add('offroad', cand.road_m >= 120 ? 10 : cand.road_m >= 60 ? 5 : cand.road_m < 20 ? -5 : 0);
  if (cand.night > 0.6 && cand.dur > 7 * 3600) add('night_rest', -5);
  if (cand.refuel) add('refuel', -20);
  // saját telephely (kivéve, ha a tervezett hely is ott van)
  if (exp.hq && dist(cand.lat, cand.lng, exp.hq.lat, exp.hq.lng) < 600) {
    const sameAsPlan = exp.cityGeo && dist(exp.cityGeo.lat, exp.cityGeo.lng, exp.hq.lat, exp.hq.lng) < 3000;
    if (!sameAsPlan) add('home_base', -50);
  }
  return { score: Math.round(sc), signals: sig };
}

// ── 3) Sorrendtartó párosítás (DP) ──────────────────────────
// stops: tervezett sorrendben; cands: időrendben; expect: stop-index → elvárás
// Visszatér: [{ stopIdx, candIdx|null, score, margin, status, signals }]
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
    const ranked = cands.map((c, j) => ({ j, score: S[i][j].score })).sort((a, b) => b.score - a.score);
    if (k == null) return { stopIdx: i, candIdx: null, score: ranked.length ? ranked[0].score : null, margin: null, status: 'unmatched', signals: [], ranked };
    const sc = S[i][k].score;
    const alt = ranked.find((r) => r.j !== k && !(Math.abs(cands[r.j].lat - cands[k].lat) < 0.002 && Math.abs(cands[r.j].lng - cands[k].lng) < 0.002));
    const margin = alt ? sc - alt.score : sc;
    const status = sc >= AUTO_SCORE && margin >= AUTO_MARGIN ? 'auto' : sc >= SUGGEST_SCORE ? 'suggested' : 'unmatched';
    return { stopIdx: i, candIdx: status === 'unmatched' ? null : k, score: sc, margin, status, signals: S[i][k].signals, ranked };
  });
}

// előzetes pontszám (reverse-geokód nélkül) — melyik jelöltnek kérjünk címet
function prescore(stops, cands, expect) {
  return cands.map((c) => Math.max(...stops.map((s, i) => scorePair(s, c, expect[i]).score)));
}

module.exports = {
  MIN_DWELL_SEC, MIN_ASSIGN, AUTO_SCORE, SUGGEST_SCORE,
  norm, placeTokens, firmaTokens, cityQuery, roadDistance, buildCandidates, scorePair, align, prescore, localDay,
};
