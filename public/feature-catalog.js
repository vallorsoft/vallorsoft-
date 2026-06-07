// public/feature-catalog.js
// A bekapcsolható/kikapcsolható menüpontok KÖZÖS katalógusa.
// Használja: admin/manager (elrejtés) + developer (kapcsolók).
// A `key` az admin/manager sidebar data-tab értéke (az utvonaltervezes a /utvonaltervezes link).
// `core:true` -> mindig elérhető, nem kapcsolható ki (pl. Beállítások).
window.VS_FEATURES = [
  { key: 'dash',             label: 'Vezérlőpult',                 group: 'Áttekintés' },
  { key: 'orders-form',      label: 'Fuvar kiírás',                group: 'Fuvarozás & Logisztika' },
  { key: 'orders-list',      label: 'Fuvar kezelés',               group: 'Fuvarozás & Logisztika' },
  { key: 'inbound',          label: 'Beérkező megrendelések',      group: 'Fuvarozás & Logisztika' },
  { key: 'received-fuv',     label: 'Fuvarlevelek',                group: 'Fuvarozás & Logisztika' },
  { key: 'driver-docs-pane', label: 'Feltöltött iratok & CMR-ek',  group: 'Fuvarozás & Logisztika' },
  { key: 'utvonaltervezes',  label: 'Útvonaltervezés',             group: 'Fuvarozás & Logisztika' },
  { key: 'users',            label: 'Munkatársak kezelése',        group: 'Adminisztráció' },
  { key: 'invites',          label: 'Meghívókódok',                group: 'Adminisztráció' },
  { key: 'internal-drivers', label: 'Belső sofőrök',               group: 'Adminisztráció' },
  { key: 'external-drivers', label: 'Külső sofőrök',               group: 'Adminisztráció' },
  { key: 'vehicles',         label: 'Járművek',                    group: 'Adminisztráció' },
  { key: 'clients',          label: 'Ügyfelek',                    group: 'Adminisztráció' },
  { key: 'integrations',     label: 'Integrációk (csak Admin)',    group: 'Adminisztráció' },
  { key: 'signature',        label: 'Aláírás és bélyegző',         group: 'Adminisztráció' },
  { key: 'chat',             label: 'Belső chat',                  group: 'Kommunikáció' },
  { key: 'settings',         label: 'Beállítások',                 group: 'Rendszer', core: true },
];
