-- ============================================================
--  GPS hónap-végi km-óra + üzemanyag-szint snapshot
--
--  Egy sor / cég / jármű / hónap. A `services/scheduler.js`
--  `startMonthEndSnapshotScheduler`-e a hónap UTOLSÓ napján
--  ~23:00-23:59 között (Europe/Bucharest) minden CargoTrack-cég
--  minden párosított járművére lekéri a `getLatestStatus`-t, és
--  ide upsertoli a mileage + fuel_level értéket (a ciklusban
--  többször is felülíródhat → a végén ~23:59-hez legközelebbi
--  friss GPS-olvasás rögzül).
--
--  A `handlers/orders.js` `getLastVehicleReadings` pre-fill-hez
--  használja: ha van snapshot ÉS a snapshot `snapped_at`-je
--  ÚJABB, mint az utolsó menetlevél érkezése (fallback: indulása),
--  akkor a snapshot mileage+fuel_level nyer. Egyébként a régi
--  logika: az utolsó menetlevél `km_sfarsit`/`cant_sfarsit`.
--  Így a hónap-határon átívelő menetlevél (jún. 28 → júl. 3) NEM
--  csorbul: annak júl. 3-i záró km-je újabb mint a jún. 30-i
--  snapshot → a következő júliusi menetlevél helyesen a júl. 3-i
--  értéknél indul, nem a jún. 30-in.
--
--  A `fuel_level` az eszköz-függő nyers érték (CargoTrack
--  `calculated_inputs.fuel_level` — vagy literben, vagy %-ban).
--  A pre-fill nyersen felajánlja, a sofőr felülírhatja.
-- ============================================================

CREATE TABLE IF NOT EXISTS gps_month_end_snapshots (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  rendszam     VARCHAR(50) NOT NULL,
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,      -- 1..12 (a snapshot mely hónap végét jelöli)
  mileage      NUMERIC(12,1),         -- GPS km-óra a hónap utolsó napján ~23:59-kor
  fuel_level   NUMERIC(10,2),         -- eszköz-függő nyers érték (liter vagy %)
  snapped_at   TIMESTAMPTZ DEFAULT NOW(),  -- a snapshot tényleges pillanata
  UNIQUE (company_id, rendszam, year, month)
);
CREATE INDEX IF NOT EXISTS idx_gps_month_end_snap
  ON gps_month_end_snapshots(company_id, rendszam, year, month);
