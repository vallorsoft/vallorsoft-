# CLAUDE.md — VallorSoft

Fuvarozási / flottakezelő webalkalmazás (Node.js + Express 5 + PostgreSQL).
Magyar nyelvű felület, román (RO) piacra szabott integrációkkal (FGO számlázás, ANAF/UIT e-fuvarlevél). PWA + web push, Firebase, multi-tenant (cégenként elkülönített adat).

## Futtatás / parancsok

```powershell
# Fejlesztés (auto-reload, nodemon devDependency)
npx nodemon server.js
# Vagy sima indítás
node server.js                      # http://localhost:3000

# Első admin felhasználó létrehozása (a DATABASE_URL-en lévő DB-be)
node create-admin.js                # az adatokat a fájl tetején szerkeszd
# DB-kapcsolat tesztelése
node test-db.js

# AES kulcs generálás INTEGRATION_ENC_KEY-hez
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- **Nincs `npm test`** (a script csak hibát dob) és nincs lint/CI. Tesztelés kézzel történik.
- Production indításhoz `NODE_ENV=production` kötelező (secure cookie + `trust proxy`-val reverse proxy mögé, pl. Render).

## Architektúra

A `server.js` (~165 sor) csak init + middleware + route-mount. Az üzleti logika:

| Mappa | Szerep |
|-------|--------|
| `routes/` | Express route-modulok (REST endpointok + oldal-route-ok) |
| `handlers/` | A `/api/execute` RPC-dispatcher függvényei (domain-logika) |
| `services/` | Külső integrációk (FGO, GPS, e-mail, push, AI, scheduler) |
| `middleware/` | `auth.js` (API: requireLogin/requireRole), `pageGuard.js` (oldalak) |
| `lib/` | `crypto.js` (AES-256-GCM integ. kulcsokhoz), `diurna.js` |
| `public/` | HTML oldalak + kliens JS-ek (admin/manager/sofer/integrációk) |
| `db/` | **Inkrementális migrációk** (külön a `schema.sql`-től — lásd lentebb) |

### Két API-minta él egymás mellett
1. **RPC dispatcher** — `POST /api/execute` `{ functionName, arguments }`. A `routes/execute.js` az összes `handlers/*` modult egy registry-be fűzi. Handler szignatúra: `async (req, res, args)`, válasz mindig `res.json({ result: { ok: true|false, err?, ... } })`.
2. **Klasszikus REST** — a többi `routes/*` modul (auth, soferApi, push, clients, cargotrack, invoices, uit, inbound-orders, client-mail, firebase, ordersRest). Válasz tipikusan `{ success: bool, message }`.

### Szerepkörök és védelem
- `req.session.user.pozicio` ∈ `Admin` | `Manager` | `Sofer`, plusz `is_dev` flag (developer hozzáférés).
- API: `requireLogin` → 401, `requireRole(...szerepek)` → 403.
- Oldalak: `requirePageLogin` / `requirePageRole(...)` → redirect a helyes felületre. `is_dev` mindenhova bejut.
- Oldal-route-ok: `/admin`, `/manager`, `/sofer`, `/developer`, `/login`, `/register`, `/reset-password`.

### Multi-tenant
Szinte minden lekérdezés `company_id`-re szűr (`req.session.user.company_id`). Új lekérdezésnél MINDIG szűrj cégre, különben adatszivárgás.

## Adatbázis

- **`schema.sql`** — teljes friss séma (`CREATE TABLE IF NOT EXISTS`). Friss telepítéshez ezt futtasd.
- **`db/*.sql`** — inkrementális migrációk meglévő DB-hez, NEM részei a `schema.sql`-nek. Élesítés előtt le kell futtatni mindet:
  - `integrations.sql`, `inbound-orders-migration.sql`, `uit-migration.sql`,
    `uit-anaf-confirm.sql`, `orders-client-link.sql`, `email-branding-migration.sql`
- Fő táblák: `companies`, `users`, `vehicles`, `orders`, `order_legs`, `order_documents`,
  `fuvarlevelek`, `driver_shifts`, `available_orders`, `invoices`, `clients`,
  `company_integrations`, `vehicle_gps_map`, `order_uit_codes`, `inbound_orders`,
  `company_branding`, `email_templates`, `client_emails`, `push_subscriptions`, `session`.
- A `session` táblát a `connect-pg-simple` automatikusan létrehozza (`createTableIfMissing`).

## Integrációk (services/)

- **`fgo.js`** — román e-számlázás (FGO v7.1). SHA-1 uppercase hash auth. Környezet: `test` (`api-testuat.fgo.ro`) → élesben `production` (`api.fgo.ro`). `invoicing.js` + `invoiceAdapter.js` a normalizált modell.
- **`cargotrack.js` + `gps/`** (`cargotrack-et.js`, `fomco-et.js`) + `gpsAdapter.js` — GPS nyomkövetés, jármű↔GPS párosítás (`vehicle_gps_map`).
- **`email-intake.js`** — IMAP-ból beérkező megrendelések; csak ha `INTAKE_IMAP_*` be van állítva. AI-feldolgozás: `order-ai/` (`gemini.js` + `heuristic.js` fallback), `pdf-extract.js` (pdf-parse + tesseract OCR).
- **`email.js`** — kimenő e-mail (Brevo API). **`webpush.js` / `push.js`** — web push (VAPID). **`firebase.js`** — Firebase admin.
- **Integrációs kulcsok** titkosítva a `company_integrations` táblában (`lib/crypto.js`, `INTEGRATION_ENC_KEY` mester-kulcs, AES-256-GCM, `iv.tag.ciphertext` base64 formátum). A felületen maszkolva jelennek meg.

## Műszak (driver_shifts) — ELTÁVOLÍTVA

- A sofőr-műszak funkció (megjelenés + backend) teljesen el lett távolítva mindhárom felületről (sofőr/manager/admin), beleértve az EU 561/2006 compliance + háttér-ütemező réteget is. A `routes/shifts.js` és a sofőr/manager/admin shift-UI megszűnt.
- A `driver_shifts` tábla adatmegőrzés miatt a DB-ben maradt, de már semmi nem hivatkozik rá. (A `db/remove-shift-compliance.sql` migráció a régi compliance-oszlopokat dobja el.)

## Ütemezők (services/scheduler.js)

- **`startIntakeScheduler()`** — 2 perces ciklus az e-mail intake-hez. Aktívan fut, de csak akkor csinál bármit, ha az `INTAKE_IMAP_*` be van állítva.

## Környezeti változók (.env)

Lokálisan `.env` (gitignore-olt). Kötelező: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `APP_URL`, `INTEGRATION_ENC_KEY` (32 byte hex/base64).
Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
E-mail: `BREVO_API_KEY`, `BREVO_SENDER`, `MAIL_USER`.
Firebase: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DB_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_SERVICE_ACCOUNT`.
AI: `GEMINI_API_KEY`, `GEMINI_MODEL`.
Intake (opcionális): `INTAKE_IMAP_HOST/PORT/USER/PASS/TLS`, `INTAKE_COMPANY_ID`, `INTAKE_MAILBOX`.

## Konvenciók

- A kód és a kommentek **magyarul** vannak. A refaktor során sok modul "bájtra azonos" a régi `server.js`-ből kivágva — ahol ez áll a fejlécben, ott a viselkedés szándékosan változatlan, óvatosan módosíts.
- Paraméteres SQL ($1, $2 …) — soha ne fűzz stringet lekérdezésbe.
- Statikus fájlok a `public/`-ból mennek ki (`express.static`); a védett HTML-eket a `routes/pages.js` szolgálja ki guard mögött.
- Biztonság: `helmet` CSP-vel (Firebase/CDN engedélyezve), rate-limit a `/api/login` (10/15p) és `/api/forgot-password` (5/1h) végpontokon.

## Élesítés (go-live) checklist

1. ✅ `.env` minden kulccsal (incl. `INTEGRATION_ENC_KEY`).
2. ⬜ `db/*.sql` migrációk lefuttatva az éles adatbázison (incl. `db/remove-shift-compliance.sql`).
3. ⬜ FGO integráció `test` → `production` váltása.
4. ⬜ Deploy: `NODE_ENV=production`, HTTPS, reverse proxy (trust proxy már beállítva).

## Tesztelés

- Jest + supertest. Parancsok: `npm test`, `npm run test:watch`, `npm run test:coverage`.
- `tests/unit/` (crypto, diurna, invoiceAdapter), `tests/integration/` (auth, execute), `tests/helpers/` (db-mock, session-mock — éles DB nem kell).