// services/gps/cargotrack-et.js
// GPS-adapter — CargoTrack (FM-Track / Ruptela). RO e-Transport: a KAPOTT UIT-kód
// hozzárendelése a jármű GPS-eszközéhez (pozíció → ANAF), majd a transport végén leállítás.
//
// A UIT-ot az ANAF generálja a megbízó deklarációjára — itt NEM generálunk, csak a kész
// kódot rendeljük a járműhöz és indítjuk/leállítjuk a küldést.
//
// A FM-Track e-Transport/UIT végpontot a CargoTrack-tól kell megerősíteni (Swagger). Amíg
// ASSIGN_PATH/UNASSIGN_PATH = null (vagy az e-Transport kapcsoló ki), "kézi/rögzítő" módban fut.
// Amint megjön a végpont: elég a két konstanst kitölteni.

const BASE = 'https://api.fm-track.com';
const TIMEOUT_MS = 15000;

// >>> A CARGOTRACK VÁLASZA UTÁN TÖLTSD KI. Addig null = kézi mód. <<<
const ASSIGN_PATH   = null;  // pl. '/objects/{objectId}/etransport'  (POST { uit })
const UNASSIGN_PATH = null;

async function fmSend(method, path, apiKey, body) {
  const url = new URL(BASE + path);
  url.searchParams.set('version', '1');
  url.searchParams.set('api_key', apiKey);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    let txt = ''; try { txt = await res.text(); } catch (_) {}
    if (!res.ok) { const e = new Error(`CargoTrack hiba (${res.status}). ${txt || ''}`.trim()); e.status = res.status; throw e; }
    try { return txt ? JSON.parse(txt) : {}; } catch (_) { return {}; }
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('Időtúllépés — a CargoTrack nem válaszolt.'); err.status = 504; throw err; }
    throw e;
  } finally { clearTimeout(t); }
}

function manual(actionLabel) {
  return { ok: true, mode: 'manual',
    message: 'Rögzítve. A tényleges ' + actionLabel + ' a CargoTrack/ANAF appból történik ' +
             '(nincs még megerősített API-végpont az automatikus küldéshez).' };
}

async function assignUit(cfg, { objectId, uit }) {
  if (!cfg || !cfg.etransport || !cfg.etransport.enabled) return manual('indítás');
  if (!ASSIGN_PATH) return manual('indítás');
  if (!objectId) { const e = new Error('Nincs GPS object_id ehhez a járműhöz (előbb párosítsd a rendszámot).'); e.status = 409; throw e; }
  const r = await fmSend('POST', ASSIGN_PATH.replace('{objectId}', encodeURIComponent(objectId)), cfg.apiKey, { uit });
  return { ok: true, mode: 'api', message: 'Küldés elindítva (GPS → ANAF).', raw: r };
}

async function unassignUit(cfg, { objectId, uit }) {
  if (!cfg || !cfg.etransport || !cfg.etransport.enabled) return manual('leállítás');
  if (!UNASSIGN_PATH) return manual('leállítás');
  if (!objectId) return manual('leállítás');
  const r = await fmSend('POST', UNASSIGN_PATH.replace('{objectId}', encodeURIComponent(objectId)), cfg.apiKey, { uit });
  return { ok: true, mode: 'api', message: 'Küldés leállítva.', raw: r };
}

module.exports = { provider: 'cargotrack', label: 'CargoTrack (FM-Track)', assignUit, unassignUit };
