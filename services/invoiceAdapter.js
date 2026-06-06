// invoice-adapter.js
// Számlázó-adapter registry. A közös felület mögé bármelyik szolgáltató bepattintható.
//
// KÖZÖS (normalizált) SZÁMLAMODELL — minden adapter ezt kapja:
//   {
//     serie: "BV",
//     currency: "RON",
//     type: "Factura",
//     client: { name, type: "PF"|"PJ", country: "RO", county, cui, address },
//     lines: [ { name, qty, unit, vatRate, unitPrice } ],
//     reverseCharge: false        // fordított adózás (taxare inversă) — ÁFA nélkül
//   }
//
// MINDEN ADAPTER FELÜLETE (szerződés):
//   emit(creds, invoice)  -> { ok, serie, numar, pdf_link, pay_link, raw } | { ok:false, message }
//   getStatus(creds, ref) -> { ok, value, paid, raw } | { ok:false, message }
//   testConnection(creds) -> { ok, message }
//
// creds: az adott szolgáltató hitelesítő adatai (titkosítva tárolva, futásidőben visszafejtve).
//   FGO: { CodUnic, PrivateKey, PlatformaUrl, environment }

const fgo = require('./fgo');

const ADAPTERS = {
  fgo,
  // smartbill: require('./smartbill-adapter'),  // később (Basic Auth: email + token)
  // oblio:     require('./oblio-adapter'),       // később (OAuth Bearer)
};

function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    const e = new Error(`A(z) "${provider}" számlázó még nincs implementálva.`);
    e.code = 'PROVIDER_NOT_IMPLEMENTED';
    throw e;
  }
  return a;
}

function listProviders() {
  return Object.keys(ADAPTERS);
}

module.exports = { getAdapter, listProviders };
