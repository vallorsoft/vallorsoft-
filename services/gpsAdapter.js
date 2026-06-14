// services/gpsAdapter.js
// GPS-provider katalógus a RO e-Transport deep-linkhez. A tényleges GPS→ANAF
// küldést NEM mi végezzük — a UIT-ügyintézés a szolgáltató saját portálján
// (deep-link) történik. Itt csak a providerek listája él (developer deep-link beállításhoz).
const GPS_PROVIDERS = [
  { provider: 'cargotrack', label: 'CargoTrack (FM-Track)' },
  { provider: 'fomco',      label: 'Fomco GPS' },
];
function listProviders() { return GPS_PROVIDERS.map((p) => p.provider); }
module.exports = { GPS_PROVIDERS, listProviders };
