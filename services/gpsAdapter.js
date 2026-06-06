// services/gpsAdapter.js
// GPS-adapter registry. A közös felület mögé bármelyik GPS/flotta-szolgáltató bepattintható.
// (Ugyanaz a minta, mint a számlázó invoiceAdapter.js-nél.)
//
// MINDEN ADAPTER FELÜLETE (szerződés) — RO e-Transport:
//   assignUit(cfg, { objectId, uit })   -> { ok, mode:'api'|'manual', message, raw? }
//   unassignUit(cfg, { objectId, uit }) -> { ok, mode, message, raw? }
//
// cfg: { provider, apiKey, etransport: { enabled, environment } }  (a kulcs titkosítva tárolva,
//       futásidőben visszafejtve). object_id a vehicle_gps_map-ból, providerenként.

const cargotrack = require('./gps/cargotrack-et');
const fomco = require('./gps/fomco-et');

const ADAPTERS = {
  cargotrack,
  fomco,
  // további GPS-szolgáltató: require('./gps/uj-szolgaltato-et'),
};

function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    const e = new Error(`A(z) "${provider}" GPS-szolgáltató e-Transport adaptere még nincs implementálva.`);
    e.code = 'PROVIDER_NOT_IMPLEMENTED';
    throw e;
  }
  return a;
}

function listProviders() { return Object.keys(ADAPTERS); }

module.exports = { getAdapter, listProviders };
