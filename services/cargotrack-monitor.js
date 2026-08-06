// ============================================================
//  services/cargotrack-monitor.js — CargoTrack (Ruptela FM-Track) hitelesítési
//  hiba-figyelő. A `services/cargotrack.js` `fmGet`-je meghívja `recordAuthFailure`-t
//  minden 401/403 válaszra. Ha rövid idő alatt (default 10 perc) elér egy
//  küszöböt (default 3) → EGY riasztó e-mail megy a DEV_NOTIFY_EMAIL-re
//  (fallback: vallorsoft@gmail.com), majd egy debounce-ablak (default 6 óra)
//  elnyeli a további hibákat, hogy ne spammoljuk a postaládát.
//
//  Cél: a 2026-08-04-i Ruptela IP-whitelist bevezetés után, ha a CargoTrack
//  szolgáltató a Fly-egress IP-nket (209.71.106.103) nem tenné a listára
//  határidőre, a GPS-integráció csendben lehalna. Így KAPUNK értesítést.
//
//  Nincs DB-függőség (in-memory state, process-live), nincs séma-változás.
//  Ha e-mail-küldés hibázna, csendben elnyeli — sosem borítja a hívó kódot.
// ============================================================

const { sendClientEmail } = require('./email');

// Konfiguráció — env-vel felülírható a rugalmasság kedvéért.
const WINDOW_MS   = Number(process.env.CARGOTRACK_ALERT_WINDOW_MS)  || 10 * 60 * 1000;  // 10 perc
const THRESHOLD   = Number(process.env.CARGOTRACK_ALERT_THRESHOLD)  || 3;                // 3 hiba
const DEBOUNCE_MS = Number(process.env.CARGOTRACK_ALERT_DEBOUNCE_MS)|| 6 * 60 * 60 * 1000; // 6 óra

// Belső állapot — process-live.
const state = {
  timestamps: [],   // {ts, status}
  lastAlertAt: 0,
};

function _pruneOld(now) {
  const cutoff = now - WINDOW_MS;
  while (state.timestamps.length && state.timestamps[0].ts < cutoff) {
    state.timestamps.shift();
  }
}

function _recipient() {
  return process.env.DEV_NOTIFY_EMAIL || 'vallorsoft@gmail.com';
}

function _buildAlertHtml(count, statuses, firstAt, lastAt) {
  const uniqStatuses = [...new Set(statuses)].sort().join(', ');
  const first = new Date(firstAt).toISOString().replace('T',' ').substring(0,19) + ' UTC';
  const last  = new Date(lastAt ).toISOString().replace('T',' ').substring(0,19) + ' UTC';
  return `
    <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:#2a2018;font-size:14px;line-height:1.6;">
      <h2 style="color:#c14a2b;margin:0 0 12px;">⚠️ CargoTrack GPS integráció — hitelesítési hiba</h2>
      <p>A <strong>CargoTrack / Ruptela FM-Track API</strong> az elmúlt <strong>${Math.round(WINDOW_MS/60000)} percben ${count}</strong> alkalommal
      utasította el a rendszer hívásait (HTTP státusz: <code>${uniqStatuses}</code>).</p>

      <p style="background:#fdf4e7;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:6px;">
      <strong>Valószínű ok:</strong> a Ruptela IP-whitelist NEM tartalmazza a Fly.io kimenő IP-jét
      (<code>209.71.106.103</code>), vagy az API-kulcs érvénytelenítve lett.
      </p>

      <p><strong>Első hiba:</strong> ${first}<br>
         <strong>Utolsó hiba:</strong> ${last}</p>

      <h3 style="margin:16px 0 6px;">Teendő</h3>
      <ol style="padding-left:22px;">
        <li>Ellenőrizd a Fly.io kimenő IP-t: <code>fly ips list -a vallorsoft</code> — a <code>209.71.106.103</code> még allokálva kell legyen (v4 egress, fra régió).</li>
        <li>Írj emberi kollégának Ruptelán: <code>support@ruptela.com</code> (CC: <code>marketing@ruptela.com</code>) — hogy nem lettél még a whitelisten.</li>
        <li>CargoTrack (viszonteladó): <code>office@cargotrack.ro</code> — kérd tőlük is a whitelist-frissítést.</li>
        <li>Amíg nincs megoldva: a Vezérlőpult „Jármű státusz" panelen NEM lesznek élő GPS-pozíciók.</li>
      </ol>

      <p style="margin-top:20px;font-size:12px;color:#8a7a68;">
        A következő ${Math.round(DEBOUNCE_MS/3600000)} órában erről már nem kapsz újabb értesítést,
        hogy ne teljen tele a postaláda.
        <br>Ez az e-mail automatikusan generálódott a VallorSoft <code>cargotrack-monitor.js</code>-ből.
      </p>
    </div>`;
}

// Publikus API — a `cargotrack.js` `fmGet`-je hívja minden 401/403-ra.
// A hívás fire-and-forget: nem `await`-eli senki, sosem dobhat.
function recordAuthFailure(status, opts) {
  try {
    // Csak a whitelist / auth jellegű státuszokra reagálunk.
    if (status !== 401 && status !== 403) return;
    const now = (opts && opts.now) || Date.now();
    _pruneOld(now);
    state.timestamps.push({ ts: now, status });

    // Ha még nem érte el a küszöböt VAGY a debounce-ablakban vagyunk, ne alertáljunk.
    if (state.timestamps.length < THRESHOLD) return;
    // Debounce CSAK akkor él, ha volt már korábbi riasztás (`lastAlertAt > 0`).
    // Enélkül a legelső riasztás is elveszne kis `now`-értékek mellett.
    if (state.lastAlertAt > 0 && now - state.lastAlertAt < DEBOUNCE_MS) return;

    // Küszöb-túllépés → riasztás.
    state.lastAlertAt = now;
    const firstAt = state.timestamps[0].ts;
    const lastAt  = state.timestamps[state.timestamps.length - 1].ts;
    const statuses = state.timestamps.map(t => t.status);
    const count = state.timestamps.length;
    // Az alert után NULLÁZZUK a listát — a debounce dolga megvédeni a spamtől.
    state.timestamps.length = 0;

    const send = (opts && opts.sendClientEmail) || sendClientEmail;
    // Fire-and-forget: a `send` egy async fn — meghívjuk (a hívás azonnal
    // regisztrálódik), és a promise-t `.catch`-eljük, hogy sose dobjon.
    // Szinkronosan visszatér, nem várunk rá.
    try {
      const p = send({
        to: _recipient(),
        subject: '⚠️ CargoTrack GPS — hitelesítési hiba (IP whitelist?)',
        html: _buildAlertHtml(count, statuses, firstAt, lastAt),
        mailType: 'cargotrack_alert',
      });
      if (p && typeof p.catch === 'function') p.catch(() => { /* nem dob */ });
    } catch (_) { /* szinkron dobás elnyelve */ }
  } catch (_) {
    // Sosem borítjuk a hívót.
  }
}

// Belső — csak tesztekhez, hogy a state resetelhető és lekérdezhető legyen.
function _resetForTests() {
  state.timestamps.length = 0;
  state.lastAlertAt = 0;
}
function _getStateForTests() {
  return {
    count: state.timestamps.length,
    lastAlertAt: state.lastAlertAt,
    threshold: THRESHOLD,
    windowMs: WINDOW_MS,
    debounceMs: DEBOUNCE_MS,
  };
}

module.exports = { recordAuthFailure };
// A tesztekhez nem-enumerable segédek — nem szivárognak a normál API-ba.
Object.defineProperty(module.exports, '_resetForTests', { value: _resetForTests, enumerable: false });
Object.defineProperty(module.exports, '_getStateForTests', { value: _getStateForTests, enumerable: false });
