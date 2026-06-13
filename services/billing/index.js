// services/billing/index.js
// Univerzális számlázó-keretrendszer: provider-metaadatok + adapter-factory.
const FgoAdapter = require('./fgo-adapter');
const SmartBillAdapter = require('./smartbill-adapter');
const OblioAdapter = require('./oblio-adapter');
const IFacturaAdapter = require('./ifactura-adapter');
const FacturisAdapter = require('./facturis-adapter');

const ADAPTERS = {
  fgo: FgoAdapter,
  smartbill: SmartBillAdapter,
  oblio: OblioAdapter,
  ifactura: IFacturaAdapter,
  facturis: FacturisAdapter,
};

// A felület ez alapján generálja a dinamikus űrlapokat (getAvailableProviders).
const PROVIDERS = [
  {
    provider: 'fgo', display_name: 'FGO', logo_url: null,
    fields: [
      { key: 'api_key', label: 'Cheie API (PrivateKey)', type: 'password' },
      { key: 'cod_unic', label: 'CodUnic (codul fiscal al firmei)', type: 'text' },
      { key: 'environment', label: 'Mediu', type: 'select', options: ['test', 'production'] },
    ],
  },
  {
    provider: 'smartbill', display_name: 'SmartBill', logo_url: null,
    fields: [
      { key: 'username', label: 'Nume de utilizator', type: 'text' },
      { key: 'token', label: 'Token', type: 'password' },
      { key: 'company_vat_code', label: 'Cod fiscal firmă (CUI)', type: 'text' },
    ],
  },
  {
    provider: 'oblio', display_name: 'Oblio', logo_url: null,
    fields: [
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'secret', label: 'Secret', type: 'password' },
      { key: 'company_vat_code', label: 'Cod fiscal firmă (CUI)', type: 'text' },
    ],
  },
  {
    provider: 'ifactura', display_name: 'iFactura', logo_url: null,
    fields: [
      { key: 'api_key', label: 'Cheie API', type: 'password' },
      { key: 'company_id', label: 'Identificator firmă', type: 'text' },
    ],
  },
  {
    provider: 'facturis', display_name: 'Facturis Online', logo_url: null,
    fields: [
      { key: 'username', label: 'Nume de utilizator', type: 'text' },
      { key: 'api_key', label: 'Cheie API', type: 'password' },
      { key: 'company_cui', label: 'CUI', type: 'text' },
    ],
  },
];

// Közös, OPCIONÁLIS számla-beállítás mezők — minden provider űrlapján
// megjelennek; a fuvar-számlázás (services/invoicing.js) ezekből olvassa a
// sorozatot/ÁFÁ-t/pénznemet (hiányukra alapértékek: serie '', 21%, RON).
const INVOICE_SETTINGS_FIELDS = [
  { key: 'serie', label: 'Serie factură — opțional', type: 'text' },
  { key: 'default_tva', label: 'TVA implicit % (implicit: 21)', type: 'text' },
  { key: 'currency', label: 'Monedă (implicit: RON)', type: 'text' },
];
for (const p of PROVIDERS) p.fields = [...p.fields, ...INVOICE_SETTINGS_FIELDS];

function getAdapter(provider, credentials) {
  const A = ADAPTERS[provider];
  if (!A) { const e = new Error('Furnizor de facturare necunoscut: ' + provider); e.code = 'UNKNOWN_PROVIDER'; throw e; }
  return new A(credentials || {});
}

function displayName(provider) {
  const p = PROVIDERS.find((x) => x.provider === provider);
  return p ? p.display_name : provider;
}

function isValidProvider(provider) { return !!ADAPTERS[provider]; }

// A feladat szerinti elnevezés (a getAdapter aliasa).
function loadAdapter(provider, credentials) { return getAdapter(provider, credentials); }

module.exports = { PROVIDERS, getAdapter, loadAdapter, displayName, isValidProvider };
