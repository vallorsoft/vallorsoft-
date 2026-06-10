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
      { key: 'api_key', label: 'API kulcs', type: 'password' },
      { key: 'environment', label: 'Környezet', type: 'select', options: ['test', 'production'] },
    ],
  },
  {
    provider: 'smartbill', display_name: 'SmartBill', logo_url: null,
    fields: [
      { key: 'username', label: 'Felhasználónév', type: 'text' },
      { key: 'token', label: 'Token', type: 'password' },
      { key: 'company_vat_code', label: 'Cég adószám (CUI)', type: 'text' },
    ],
  },
  {
    provider: 'oblio', display_name: 'Oblio', logo_url: null,
    fields: [
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'secret', label: 'Secret', type: 'password' },
      { key: 'company_vat_code', label: 'Cég adószám (CUI)', type: 'text' },
    ],
  },
  {
    provider: 'ifactura', display_name: 'iFactura', logo_url: null,
    fields: [
      { key: 'api_key', label: 'API kulcs', type: 'password' },
      { key: 'company_id', label: 'Cég azonosító', type: 'text' },
    ],
  },
  {
    provider: 'facturis', display_name: 'Facturis Online', logo_url: null,
    fields: [
      { key: 'username', label: 'Felhasználónév', type: 'text' },
      { key: 'api_key', label: 'API kulcs', type: 'password' },
      { key: 'company_cui', label: 'CUI', type: 'text' },
    ],
  },
];

function getAdapter(provider, credentials) {
  const A = ADAPTERS[provider];
  if (!A) { const e = new Error('Ismeretlen számlázó: ' + provider); e.code = 'UNKNOWN_PROVIDER'; throw e; }
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
