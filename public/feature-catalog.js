// public/feature-catalog.js
// A bekapcsolható/kikapcsolható menüpontok KÖZÖS katalógusa.
// Használja: admin/manager (elrejtés) + developer (kapcsolók).
// A `key` az admin/manager sidebar data-tab értéke (az utvonaltervezes a /utvonaltervezes link).
// `core:true` -> mindig elérhető, nem kapcsolható ki (pl. Beállítások).
window.VS_FEATURES = [
  { key: 'dash',             label: 'Vezérlőpult',                 group: 'Áttekintés' },
  { key: 'orders-form',      label: 'Fuvar kiírás',                group: 'Fuvarozás & Logisztika' },
  { key: 'orders-list',      label: 'Fuvar kezelés',               group: 'Fuvarozás & Logisztika' },
  { key: 'orders-import',    label: 'Fuvar CSV-import (📥)',        group: 'Fuvarozás & Logisztika' },
  // OPT-IN (alapból KI): ügyfél-portál — a megrendelő saját belépéssel látja
  // a fuvarjait + dokumentumokat, és új fuvart igényelhet. Developer kapcsolja.
  { key: 'client-portal',    label: 'Ügyfél-portál (🔑)',          group: 'Fuvarozás & Logisztika', optIn: true },
  { key: 'carrier-portal',   label: 'Alvállalkozói portál (🔑)',   group: 'Fuvarozás & Logisztika', optIn: true },
  { key: 'inbound',          label: 'Beérkező megrendelések',      group: 'Fuvarozás & Logisztika' },
  { key: 'client-requests',  label: 'Ügyfél kérések (📋)',         group: 'Fuvarozás & Logisztika' },
  { key: 'orders-planner',   label: 'Tervezőtábla (diszpécser)',   group: 'Fuvarozás & Logisztika' },
  { key: 'received-fuv',     label: 'Fuvarlevelek',                group: 'Fuvarozás & Logisztika' },
  { key: 'warehouse',        label: 'Raktár (leadott áru) 📦',     group: 'Fuvarozás & Logisztika' },
  { key: 'driver-docs-pane', label: 'Feltöltött iratok & CMR-ek',  group: 'Fuvarozás & Logisztika' },
  { key: 'ecmr',             label: 'e-CMR (digitális CMR) 📝',     group: 'Dokumentumok' },
  { key: 'utvonaltervezes',  label: 'Útvonaltervezés',             group: 'Fuvarozás & Logisztika' },
  // OPT-IN (alapból KI): a fuvar-kiírón térképes cím-kiegészítés + auto-km
  // + útvonal-előnézet köztespontokkal. A developer kapcsolja be cégenként.
  { key: 'order-route-map',  label: 'Térképes km + útvonal-előnézet (fuvar-kiírás) 🗺️', group: 'Fuvarozás & Logisztika' },
  { key: 'stats-overview',   label: 'Statisztika — Áttekintés',    group: 'Statisztika & Riport' },
  { key: 'stats-finance',    label: 'Statisztika — Pénzügy',       group: 'Statisztika & Riport' },
  { key: 'stats-fuel',       label: 'Statisztika — Fogyasztás',    group: 'Statisztika & Riport' },
  { key: 'stats-purchases',  label: 'Statisztika — Vásárlások',    group: 'Statisztika & Riport' },
  { key: 'stats-drivers',    label: 'Statisztika — Sofőr teljesítmény', group: 'Statisztika & Riport' },
  { key: 'stats-vehicles',   label: 'Statisztika — Jármű kihasználtság', group: 'Statisztika & Riport' },
  { key: 'stats-clients',    label: 'Statisztika — Ügyfél riport', group: 'Statisztika & Riport' },
  { key: 'stats-co2',        label: 'Statisztika — CO₂ riport',    group: 'Statisztika & Riport' },
  { key: 'decont',           label: 'Sofőr-elszámolás (decont)',   group: 'Fuvarozás & Logisztika' },
  { key: 'invoices-out',     label: 'Kimenő számlák 📤',           group: 'Pénzügy' },
  { key: 'invoices-in',      label: 'Bejövő számlák (alvállalkozói) 📥', group: 'Pénzügy' },
  // 'tracking': nem menüpont, hanem a fuvarlista 🌍 gombja (publikus ügyfél
  // követő-link) — a kapcsoló a gombot és a link-generálást tiltja.
  { key: 'tracking',         label: 'Ügyfél tracking-link (🌍)',   group: 'Fuvarozás & Logisztika' },
  { key: 'expiries',         label: 'Lejáratok & riasztások',      group: 'Flotta & Megfelelés' },
  { key: 'service-log',      label: 'Szerviz & karbantartás',      group: 'Flotta & Megfelelés' },
  { key: 'fuel-import',      label: 'Üzemanyagkártya-import (⛽)',  group: 'Flotta & Megfelelés' },
  // 'monthly-report': nem menüpont — a havi e-mail összefoglalót kapcsolja (scheduler).
  { key: 'monthly-report',   label: 'Havi e-mail összefoglaló (📧)', group: 'Flotta & Megfelelés' },
  { key: 'users',            label: 'Munkatársak kezelése',        group: 'Adminisztráció' },
  { key: 'invites',          label: 'Meghívókódok',                group: 'Adminisztráció' },
  { key: 'internal-drivers', label: 'Belső sofőrök',               group: 'Adminisztráció' },
  { key: 'external-drivers', label: 'Külső sofőrök',               group: 'Adminisztráció' },
  { key: 'vehicles',         label: 'Járművek',                    group: 'Adminisztráció' },
  { key: 'clients',          label: 'Ügyfelek',                    group: 'Adminisztráció' },
  // FIGYELEM: a 'billing' fül CSAK a Manager felületen létezik, az
  // 'integrations' CSAK az Adminon — a kapcsoló a másik szerepkörre nem hat.
  { key: 'billing',          label: 'Számlázás fül (csak Manager)', group: 'Adminisztráció' },
  { key: 'integrations',     label: 'Integrációk fül (csak Admin)', group: 'Adminisztráció' },
  { key: 'signature',        label: 'Aláírás és bélyegző',         group: 'Adminisztráció' },
  { key: 'chat',             label: 'Belső chat',                  group: 'Kommunikáció' },
  { key: 'settings',         label: 'Beállítások',                 group: 'Rendszer', core: true },
  // ── Prémium funkció-gate-ek (csomag-szintű korlátozáshoz) ──────────────────
  { key: 'visszfuvar-radar',     label: 'Visszfuvar-radar 🎯',          group: 'Fuvarozás & Logisztika' },
  { key: 'toll-becsles',         label: 'Útdíj-becslés 🛣️',             group: 'Fuvarozás & Logisztika' },
  { key: 'ai-kiolvasas',         label: 'AI kiolvasás (Gemini) 🤖',     group: 'Fuvarozás & Logisztika' },
  { key: 'gps-integracio',       label: 'GPS integráció 📡',            group: 'Adminisztráció' },
  { key: 'szamlazas-integracio', label: 'Számlázó integráció 🧾',        group: 'Adminisztráció' },
  { key: 'konyvelo-szerepkor',   label: 'Könyvelő szerepkör 📚',        group: 'Adminisztráció' },
];
