# ============================================================
#  VallorSoft — Dockerfile (Fly.io / bármilyen konténeres deploy)
#  Két lépcsős build: a "builder" lefordítja a natív függőséget (bcrypt),
#  a futtató image karcsú marad. A migrációk a szerver indulásakor
#  automatikusan lefutnak (server.js), külön release-parancs NEM kell.
# ============================================================

# ---- 1) Builder: production node_modules (natív bcrypt fordítással) ----
FROM node:22-bookworm AS builder
WORKDIR /app

# Natív modulokhoz (bcrypt) szükséges build-eszközök
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Csak production függőségek, reprodukálható telepítés
RUN npm ci --omit=dev

# ---- 2) Runtime: karcsú image ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# pg_dump az opcionális automatikus DB-mentéshez (BACKUP_ENABLED=true).
# Ha nem kell backup, ez a réteg nyugodtan elhagyható.
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Lefordított függőségek a builderből + alkalmazás-kód
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# A szerver alapból a 3000-es porton figyel (process.env.PORT || 3000).
# A fly.toml internal_port = 3000 ehhez igazodik.
EXPOSE 3000

CMD ["node", "server.js"]
