# VallorSoft — Átállás Renderről Fly.io-ra

Ez az útmutató végigvezet a Render → Fly.io migráción. Az alkalmazás
**állapotmentes** (a feltöltött dokumentumok a PostgreSQL-ben vannak, nem
lemezen), a sessionök is a DB-ben (`connect-pg-simple`), a migrációk pedig
induláskor automatikusan lefutnak — így a konténerizálás egyszerű.

A repóban már megvan:
- `Dockerfile` — kétlépcsős build (natív `bcrypt` fordítás + karcsú runtime)
- `.dockerignore`
- `fly.toml` — app-konfiguráció (port 8080 = Fly alapértelmezett, `/healthz` health-check, 1 állandó példány)

> A `render.yaml` szándékosan **bent marad**, hogy az átállás alatt a Render
> deploy is működjön. A Fly.io élesedése után törölhető.

---

## 1) Fly CLI telepítése és belépés

```bash
# flyctl telepítés (macOS/Linux)
curl -L https://fly.io/install.sh | sh
# vagy: brew install flyctl

fly auth login          # böngészős belépés / regisztráció
```

## 2) Adatbázis — DÖNTÉS (ez az egyetlen valódi mérlegelendő pont)

A jelenlegi adatok a Render PostgreSQL-ben vannak. Két út:

### A) Marad a meglévő (külső) Postgres — *legegyszerűbb, nincs adatmozgatás*
A Render Postgres (vagy egy managed szolgáltató: Neon, Supabase, stb.) tovább
használható; csak a Fly app `DATABASE_URL`-jét állítod rá. Külső eléréshez a
Render Postgresnél engedélyezni kell a külső kapcsolatot (External Connection
String), és SSL kell. **Ajánlott első körben** — kockázatmentes, gyors.

### B) Fly Postgres + adat-átköltöztetés
```bash
fly postgres create --name vallorsoft-db --region waw   # vagy Neon/Supabase
# Adat-átmásolás a Render DB-ből:
pg_dump "<RENDER_EXTERNAL_DATABASE_URL>" -Fc -f dump.bak
fly proxy 5432 -a vallorsoft-db &                        # alagút a Fly DB-hez
pg_restore -d "<FLY_DATABASE_URL>" --no-owner dump.bak
```
A `fly postgres create` kiírja a belső `DATABASE_URL`-t; `fly postgres attach`
automatikusan be is állítja titokként a fő appnak.

> A migrációk induláskor amúgy is lefutnak, de a **meglévő üzleti adatokat**
> (cégek, fuvarok, dokumentumok) csak a fenti `pg_dump`/`pg_restore` viszi át.

## 3) App létrehozása

A `fly.toml` már megvan, ezért **ne** generáltass újat:

```bash
fly launch --no-deploy --copy-config --name vallorsoft --region waw
```
(Ha a `vallorsoft` név foglalt, válassz másikat, és írd át a `fly.toml`
`app = "..."` sorát.)

## 4) Titkok beállítása

A Render „Environment" füléről átmásolt értékek. **Minimum kötelező:**

```bash
fly secrets set \
  DATABASE_URL="postgres://...?sslmode=require" \
  SESSION_SECRET="..." \
  INTEGRATION_ENC_KEY="..." \
  APP_URL="https://vallorsoft.fly.dev"
```

> ⚠️ Az `INTEGRATION_ENC_KEY` **pontosan ugyanaz** legyen, mint Renderen —
> különben a titkosított integrációs kulcsok (GPS, számlázó, IMAP, e-mail
> feladó) nem fejthetők vissza! Ugyanígy a `SESSION_SECRET` (különben minden
> aktív munkamenet kijelentkezik — ez utóbbi nem végzetes).

> Az `APP_URL`-t **tiszta URL-ként** add meg (NE markdown `[url](url)`
> formában) — erre a kódban külön védelem is van (`lib/appUrl.js`), de a helyes
> env a biztos. Egyedi domainnél ez lesz a végleges cím.

**A többi (opcionális, ha használod):**
```bash
fly secrets set \
  VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_EMAIL="mailto:admin@..." \
  BREVO_API_KEY="..." BREVO_SENDER="noreply@..." MAIL_USER="noreply@..." \
  FIREBASE_API_KEY="..." FIREBASE_AUTH_DOMAIN="..." FIREBASE_DB_URL="..." \
  FIREBASE_PROJECT_ID="..." FIREBASE_APP_ID="..." FIREBASE_SERVICE_ACCOUNT='{...}' \
  GEMINI_API_KEY="..." \
  ORS_API_KEY="..."
```
(`NODE_ENV` és `PORT` a `fly.toml`-ban van, nem titokként.)

## 5) Deploy

```bash
fly deploy
fly logs            # induláskor: „Migráció lefuttatva: …" sorok + „Szerver fut…"
fly open            # böngészőben megnyitja
```

## 6) Ellenőrzés (élesítés előtt)

- `https://<app>.fly.dev/healthz` → 200
- `https://<app>.fly.dev/readyz` → 200 (DB elérhető)
- Belépés, egy fuvar megnyitása, egy integráció-fül (visszafejthetők-e a kulcsok → jó `INTEGRATION_ENC_KEY`)

## 7) Domain átállítás

```bash
fly certs add tinydomained.example.com     # saját domain
# majd a DNS-nél A/AAAA vagy CNAME a Fly által kiírt célra
```
Frissítsd az `APP_URL` titkot a végleges domainre, és deployolj újra.

## 8) Render leállítása (csak miután a Fly stabil)

- Render dashboard → service → Suspend/Delete.
- A `render.yaml` és a CI Render-deploy lépése törölhető (lásd lent).

---

## CI / automatikus deploy (opcionális)

A `.github/workflows/ci.yml` jelenleg main-push után **Renderre** deployol egy
deploy-hookkal. Fly.io-ra cserélve:

```yaml
  deploy:
    name: Deploy to Fly.io
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```
Token: `fly tokens create deploy` → tedd be GitHub Secret-nek `FLY_API_TOKEN`
néven. Ezt csak akkor cseréld be, ha már sikeres volt a kézi `fly deploy`.

---

## Megjegyzések az appra szabva

- **Skálázás:** a sessionök és feltöltések a DB-ben vannak, így több gép is
  futhat. DE a beépített ütemezők (IMAP-poll, e-Factura-státusz, lejárat/szerviz
  riasztás, backup) gépenként külön futnának → több példánynál duplán
  küldhetnek értesítést. Ezért a `fly.toml`-ban `min_machines_running = 1` és
  egyetlen géppel induljunk; ha terhelés miatt skálázni kell, a schedulereket
  érdemes külön „worker" process-be kiemelni (jövőbeli feladat).
- **`auto_stop_machines = "stop"`:** tétlenkor leáll, kérésre felébred (spórol).
  Mivel a schedulerek folyamatos futást igényelnek, `min_machines_running = 1`
  miatt a gép gyakorlatilag mindig fut — ez tudatos.
- **Memória:** a `tesseract.js` (OCR) és `pdf-parse` miatt 512 MB az ajánlott
  alsó határ; ha az AI-kiolvasás OOM-ol, emeld 1 GB-ra (`fly scale memory 1024`).
- **`pg_dump`:** a Dockerfile tartalmazza a `postgresql-client`-et az opcionális
  beépített backuphoz. Fly-on a lemez nem perzisztens — ha a beépített backupot
  használnád, kell egy Fly Volume (`fly volumes create`) és `BACKUP_DIR` arra
  mutasson; egyébként hagyd kikapcsolva (alap), és a Postgres szolgáltató saját
  mentését használd.

---

## 🗄️ Teljes rendszer-mentés és újraélesztés (Cloudflare R2)

**Mit ment:** a TELJES adatbázist (minden cég, minden adat — a dokumentumok, fotók,
PDF-ek is az adatbázisban vannak). A kód a GitHubon van, a beállítások a Fly-secretekben.

- **Havonta egy teljes mentés** (`pg_dump`), utána **minden éjjel csak a változások**
  (alap 03:00 Bukarest, `SYSTEM_BACKUP_HOUR`). Az első futáskor teljes mentés készül.
- Titkosítva (AES-256-GCM) a `vallorsoft` R2-tárolóba: `system/ÉÉÉÉ/HH/full-….vsdb`
  és `delta-….vsbk`, mindegyik mellett egy `.json` leíró.
- Megőrzés: változás-mentések 35 nap, teljes mentések 1 év.
- Hiba esetén e-mail megy a developernek; állapot: Developer → 🛡️ Biztonsági mentés →
  „🗄️ Teljes rendszer-mentés" (ott van a „Mentés most" / „Teljes mentés most" gomb is).

### ⚠️ Ezeket a szerveren KÍVÜL is őrizd meg (jelszókezelőben)

| Secret | Miért |
|---|---|
| `INTEGRATION_ENC_KEY` | **nélküle a mentés nem nyitható ki** (és a tárolt integrációs kulcsok sem) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` (vagy `R2_ACCOUNT_ID`), `R2_BUCKET` | a mentések letöltéséhez |
| `SESSION_SECRET`, `VAPID_*`, `BREVO_*`, `FIREBASE_*`, `GEMINI_API_KEY` … | az új szerver beállításához |

A secretek listája: `fly secrets list -a vallorsoft` (az értékeket ez nem mutatja — azokat a
beállításkor kell elmenteni).

### Újraélesztés lépésről lépésre

1. **Új, üres adatbázis** (pl. új Neon-projekt vagy -branch). Jegyezd fel a kapcsolati címét
   (a NEM `-pooler` változatot).
2. Egy gépen, ahol van **Node 22** és legalább akkora főverziójú **`pg_restore`**, mint a
   mentést készítő `pg_dump` (a Developer felület kiírja), a repó mappájában:
   ```bash
   npm ci
   ```
   ```bash
   export INTEGRATION_ENC_KEY=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_ENDPOINT=https://<fiók>.r2.cloudflarestorage.com R2_BUCKET=vallorsoft
   ```
3. Mi van a tárhelyen:
   ```bash
   node scripts/system-restore.js --list
   ```
4. Visszaállítás a legfrissebb állapotra (vagy `--at 2026-12-01T03:30:00Z` egy korábbira):
   ```bash
   node scripts/system-restore.js --target "postgres://user:pass@host/db?sslmode=require" --yes
   ```
   Ez letölti a teljes mentést (`pg_restore`), majd sorban rárakja a változás-mentéseket,
   és beállítja a sorszámlálókat.
5. A Fly-on állítsd át a `DATABASE_URL`-t az új adatbázisra, és indítsd újra:
   ```bash
   fly secrets set -a vallorsoft DATABASE_URL="postgres://…"
   ```
6. Ellenőrzés: `/readyz`, belépés, néhány cég adatai. Ha az egész Fly-app is elveszett,
   előbb az 1–5. szakasz szerint hozd létre újra (ugyanazokkal a secretekkel).
