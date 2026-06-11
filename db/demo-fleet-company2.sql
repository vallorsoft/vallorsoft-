-- ============================================================
--  VallorSoft — DEMO flotta-adatok a 2-es céghez (egyszer fut le)
--  A demo fuvarokhoz (CMD-DEMO*) kapcsolódó, ÖSSZEFÜGGŐ minta-adatok,
--  hogy MINDEN modul tartalommal teljen meg:
--   1. fuvarlevelek (menetlevelek) — km, tankolások, kiadások, diurna,
--      order_ids-szel a demo fuvarokhoz kötve (→ statisztika, fuvar-profit)
--   2. ügyfelek — fizetési határidővel (15/30/45 nap)
--   3. lejáratok — ITP LEJÁRT, RCA 12 nap, rovinietă, tahográf, CASCO
--      (→ Vezérlőpult riasztás-sáv + push)
--   4. szerviz-napló — olajcsere/gumi/javítás költségekkel
--   5. sofőr-előlegek (decont) + diurna-ráták (csak ha nincs beállítva)
--   6. üzemanyagkártya-tranzakciók (DKV/OMV) — szándékos eltéréssel a
--      sofőr-tankolásokhoz képest (→ eltérés-riport)
--   7. POD-fotók fuvarhoz kötve (→ 📷 jelzők)
--   8. GPS km-óra napló 14 napra (→ GPS-km vs. menetlevél-km panel)
--  Ha a 2-es cég nem létezik, csendben kimarad. Idempotens.
--  TÖRLÉS:
--    DELETE FROM fuvarlevelek WHERE id LIKE 'MT-DEMO%';
--    DELETE FROM documents WHERE file_name LIKE 'demo-pod%';
--    DELETE FROM document_expiries WHERE note = 'DEMO';
--    DELETE FROM vehicle_service_log WHERE description LIKE 'DEMO:%';
--    DELETE FROM driver_advances WHERE note LIKE 'DEMO%';
--    DELETE FROM fuel_card_transactions WHERE company_id=2 AND product LIKE 'DEMO%';
--    DELETE FROM gps_mileage_log WHERE company_id=2;
-- ============================================================

DO $$
DECLARE
  v_email TEXT; v_nume TEXT; v_truck TEXT; v_truck_id INTEGER; v_plate TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = 2) THEN
    RAISE NOTICE 'demo-fleet: nincs 2-es cég, kihagyva'; RETURN;
  END IF;

  SELECT email, nume INTO v_email, v_nume FROM users
   WHERE company_id = 2 AND pozicio = 'Sofer'
     AND (nume ILIKE '%lorincz%' OR nume ILIKE '%peto%' OR nume ILIKE '%pető%') LIMIT 1;
  IF v_email IS NULL THEN
    SELECT email, nume INTO v_email, v_nume FROM users
     WHERE company_id = 2 AND pozicio = 'Sofer' LIMIT 1;
  END IF;
  IF v_email IS NULL THEN
    RAISE NOTICE 'demo-fleet: nincs sofőr a 2-es cégben, kihagyva'; RETURN;
  END IF;

  SELECT id, rendszam INTO v_truck_id, v_truck FROM vehicles
   WHERE company_id = 2 AND tip = 'Vontato'
     AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) = 'B104VLR' LIMIT 1;
  IF v_truck IS NULL THEN
    SELECT id, rendszam INTO v_truck_id, v_truck FROM vehicles
     WHERE company_id = 2 AND tip = 'Vontato' AND activ = TRUE LIMIT 1;
  END IF;
  v_plate := UPPER(REGEXP_REPLACE(COALESCE(v_truck,'B104VLR'),'[^A-Za-z0-9]','','g'));

  -- Névleges fogyasztás a tényleges-vs-névleges összevetéshez (csak ha üres)
  IF v_truck_id IS NOT NULL THEN
    UPDATE vehicles SET fuel_per_100km = 29.5 WHERE id = v_truck_id AND fuel_per_100km IS NULL;
  END IF;
  -- Diurna-ráták a decont-számításhoz (csak ha nincs beállítva)
  UPDATE companies SET diurna_ext_rate = COALESCE(diurna_ext_rate, 87.50),
                       diurna_int_rate = COALESCE(diurna_int_rate, 57.50)
   WHERE id = 2;

  -- ── 1) MENETLEVELEK (a Finalizat demo fuvarokhoz kötve) ──
  INSERT INTO fuvarlevelek (id, file_name, data_completare, email_sofer, nume_sofer,
    numar_camion, numar_remorca, numar_fisa, km_inceput, km_sfarsit, total_km,
    loc_plecare, loc_sosire, diurna_externa, diurna_interna,
    cant_inceput, cant_sfarsit, motorina_folosit, total_alim, consum_100,
    alte_mentiuni, alimentari, achizitii, puncte, order_ids)
  VALUES
  ('MT-DEMO01','mt-demo-01.pdf',(CURRENT_DATE-16)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9001', 410100, 411900, 1800,
   'Cluj-Napoca','Frankfurt', 4, 0, 310, 195, 575, 460, 31.9,
   'DEMO menetlevél',
   '[{"loc":"OMV Borș","tip":"Motorină","litru":260,"km":410450,"plata":"DKV","suma":1430},
     {"loc":"Shell Nürnberg","tip":"Motorină","litru":200,"km":411300,"plata":"Card","suma":1180},
     {"loc":"OMV Borș","tip":"AdBlue","litru":40,"km":410450,"plata":"DKV","suma":92}]'::jsonb,
   '[{"produs":"Parkolás A3","loc":"Németország","pret":120,"plata":"Cash"},
     {"produs":"Autópálya-matrica HU","loc":"Hegyeshalom","pret":280,"plata":"Card"}]'::jsonb,
   '[{"tip":"Încărcare","loc":"Cluj-Napoca","data":"demo"},{"tip":"Descărcare","loc":"Frankfurt","data":"demo"}]'::jsonb,
   '["CMD-DEMO12"]'::jsonb),
  ('MT-DEMO02','mt-demo-02.pdf',(CURRENT_DATE-23)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9002', 408900, 410100, 1200,
   'Deva','Wien', 3, 0, 250, 180, 430, 360, 35.8,
   'DEMO — magas fogyasztás (túlfogyasztás-riasztás teszt)',
   '[{"loc":"MOL Nădlac","tip":"Motorină","litru":360,"km":409400,"plata":"DKV","suma":1980}]'::jsonb,
   '[{"produs":"Kamionmosás","loc":"Wien","pret":150,"plata":"Cash"}]'::jsonb,
   '[]'::jsonb, '["CMD-DEMO13"]'::jsonb),
  ('MT-DEMO03','mt-demo-03.pdf',(CURRENT_DATE-10)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9003', 411900, 413350, 1450,
   'Oradea','Linz', 3, 1, 195, 210, 425, 440, 29.3,
   'DEMO menetlevél',
   '[{"loc":"Petrom Oradea","tip":"Motorină","litru":300,"km":412000,"plata":"Cash","suma":1700},
     {"loc":"OMV Linz","tip":"Motorină","litru":140,"km":413100,"plata":"DKV","suma":840}]'::jsonb,
   '[{"produs":"Parkolás","loc":"Linz","pret":95,"plata":"Cash"},
     {"produs":"Ponyva-javítás","loc":"Győr","pret":340,"plata":"Cash"}]'::jsonb,
   '[]'::jsonb, '["CMD-DEMO14"]'::jsonb),
  ('MT-DEMO04','mt-demo-04.pdf',(CURRENT_DATE-37)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9004', 404100, 408900, 4800,
   'Brașov','Madrid', 8, 0, 280, 240, 1480, 1440, 30.8,
   'DEMO — hosszú túra',
   '[{"loc":"MOL Nădlac","tip":"Motorină","litru":480,"km":404900,"plata":"DKV","suma":2640},
     {"loc":"Repsol Zaragoza","tip":"Motorină","litru":520,"km":406800,"plata":"DKV","suma":3020},
     {"loc":"AS24 Lyon","tip":"Motorină","litru":440,"km":408200,"plata":"DKV","suma":2510},
     {"loc":"MOL Nădlac","tip":"AdBlue","litru":60,"km":404900,"plata":"DKV","suma":138}]'::jsonb,
   '[{"produs":"Komp / útdíj FR","loc":"Franciaország","pret":620,"plata":"Card"},
     {"produs":"Parkolás (őrzött)","loc":"Zaragoza","pret":180,"plata":"Cash"}]'::jsonb,
   '[]'::jsonb, '["CMD-DEMO15"]'::jsonb),
  ('MT-DEMO05','mt-demo-05.pdf',(CURRENT_DATE-6)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9005', 413350, 414270, 920,
   'Cluj-Napoca','Budapest', 0, 2, 210, 175, 295, 260, 32.1,
   'DEMO menetlevél',
   '[{"loc":"MOL Cluj","tip":"Motorină","litru":260,"km":413500,"plata":"Cash","suma":1490}]'::jsonb,
   '[{"produs":"Parkolás M0","loc":"Budapest","pret":60,"plata":"Cash"}]'::jsonb,
   '[]'::jsonb, '["CMD-DEMO16"]'::jsonb),
  ('MT-DEMO06','mt-demo-06.pdf',(CURRENT_DATE-4)::timestamp, v_email, v_nume,
   v_truck,'CJ01TRL','MT-2026-9006', 414270, 415350, 1080,
   'Timișoara','Graz', 2, 0, 175, 190, 315, 330, 29.2,
   'DEMO menetlevél',
   '[{"loc":"OMV Timișoara","tip":"Motorină","litru":330,"km":414400,"plata":"DKV","suma":1850}]'::jsonb,
   '[{"produs":"Vignetta AT","loc":"Graz","pret":145,"plata":"Card"}]'::jsonb,
   '[]'::jsonb, '["CMD-DEMO17","CMD-DEMO18"]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2) ÜGYFELEK fizetési határidővel ──
  INSERT INTO clients (company_id, denumire, tip, cui_cif, judet, localitate, email, telefon,
                       default_tva, valuta, payment_term_days, nota)
  SELECT 2, c.denumire, 'PJ', c.cui, c.judet, c.loc, c.email, c.tel, 21, 'RON', c.term, 'DEMO ügyfél'
  FROM (VALUES
    ('Kaufland Logistics SRL','RO15999000','București','București','logistic@kaufland-demo.ro','+40 21 555 0001', 45),
    ('Profi Rom Food','RO11607939','Cluj','Cluj-Napoca','transport@profi-demo.ro','+40 26 455 0002', 30),
    ('Arabesque SRL','RO6646521','Galați','Galați','dispo@arabesque-demo.ro','+40 23 655 0003', 15),
    ('DedeMan','RO2816464','Bacău','Bacău','log@dedeman-demo.ro','+40 23 455 0004', 30)
  ) AS c(denumire, cui, judet, loc, email, tel, term)
  WHERE NOT EXISTS (SELECT 1 FROM clients x WHERE x.company_id = 2 AND x.denumire = c.denumire);

  -- ── 3) LEJÁRATOK (riasztás-demo: van LEJÁRT és hamarosan lejáró is) ──
  INSERT INTO document_expiries (company_id, entity_type, entity_label, doc_type, expiry_date, alert_days, note)
  SELECT 2, e.etype, e.label, e.dtype, e.exp, e.alert, 'DEMO'
  FROM (VALUES
    ('vehicle', NULL, 'ITP (műszaki)',          CURRENT_DATE - 5,  30),
    ('vehicle', NULL, 'RCA (kötelező bizt.)',   CURRENT_DATE + 12, 30),
    ('vehicle', NULL, 'Rovinietă',              CURRENT_DATE + 45, 30),
    ('vehicle', NULL, 'CASCO',                  CURRENT_DATE + 8,  14),
    ('driver',  NULL, 'Tahográf-kártya',        CURRENT_DATE + 20, 30),
    ('driver',  NULL, 'Orvosi/pszichológiai',   CURRENT_DATE + 95, 30)
  ) AS e(etype, label, dtype, exp, alert)
  WHERE NOT EXISTS (SELECT 1 FROM document_expiries x
                    WHERE x.company_id = 2 AND x.doc_type = e.dtype AND x.note = 'DEMO');
  UPDATE document_expiries SET entity_label = CASE WHEN entity_type='vehicle' THEN v_truck ELSE v_nume END
   WHERE company_id = 2 AND note = 'DEMO' AND entity_label IS NULL;

  -- ── 4) SZERVIZ-NAPLÓ ──
  IF v_truck_id IS NOT NULL THEN
    INSERT INTO vehicle_service_log (company_id, vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km)
    SELECT 2, v_truck_id, s.d, s.km, s.cat, s.descr, s.cost, s.nd, s.nkm
    FROM (VALUES
      (CURRENT_DATE - 60, 405200, 'olajcsere',    'DEMO: olaj + szűrők (motor/levegő/üzemanyag)', 1850, NULL::date, 485000),
      (CURRENT_DATE - 30, 409800, 'gumi',         'DEMO: 4 db hajtott tengely gumi csere',        4200, NULL,       NULL::int),
      (CURRENT_DATE - 10, 413400, 'javitas',      'DEMO: féltengely szimering + fékbetét',         950, NULL,       NULL),
      (CURRENT_DATE - 90, 401000, 'karbantartas', 'DEMO: éves nagy szerviz',                      1200, CURRENT_DATE + 275, NULL)
    ) AS s(d, km, cat, descr, cost, nd, nkm)
    WHERE NOT EXISTS (SELECT 1 FROM vehicle_service_log x
                      WHERE x.company_id = 2 AND x.description = s.descr);
  END IF;

  -- ── 5) SOFŐR-ELŐLEGEK (decont) ──
  INSERT INTO driver_advances (company_id, email_sofer, amount, currency, given_at, note, created_by)
  SELECT 2, v_email, a.amt, 'RON', a.d, a.note, 'demo-seed'
  FROM (VALUES
    (2000.00, CURRENT_DATE - 20, 'DEMO kassza-feltöltés (Madrid túra)'),
    (1500.00, CURRENT_DATE - 10, 'DEMO előleg'),
    ( 800.00, CURRENT_DATE - 3,  'DEMO előleg (Graz)')
  ) AS a(amt, d, note)
  WHERE NOT EXISTS (SELECT 1 FROM driver_advances x
                    WHERE x.company_id = 2 AND x.note = a.note);

  -- ── 6) ÜZEMANYAGKÁRTYA-TRANZAKCIÓK (DKV/OMV) — kis eltéréssel a
  --      sofőr által beírtakhoz képest (eltérés-riport demo) ──
  INSERT INTO fuel_card_transactions (company_id, source, rendszam, tx_date, product, qty_l, amount_ron, dedup_hash)
  SELECT 2, t.src, v_plate, t.d, t.prod, t.l, t.amt,
         md5(t.src || v_plate || t.d::text || t.l::text || t.amt::text)
  FROM (VALUES
    ('dkv', CURRENT_DATE - 16, 'DEMO Motorină', 260.0, 1430.00),
    ('dkv', CURRENT_DATE - 16, 'DEMO AdBlue',    40.0,   92.00),
    ('dkv', CURRENT_DATE - 23, 'DEMO Motorină', 360.0, 1980.00),
    ('dkv', CURRENT_DATE - 10, 'DEMO Motorină', 140.0,  840.00),
    ('dkv', CURRENT_DATE - 37, 'DEMO Motorină', 480.0, 2640.00),
    ('dkv', CURRENT_DATE - 36, 'DEMO Motorină', 520.0, 3020.00),
    ('dkv', CURRENT_DATE - 35, 'DEMO Motorină', 440.0, 2510.00),
    ('omv', CURRENT_DATE - 4,  'DEMO Motorină', 330.0, 1850.00),
    -- ez a kettő NINCS a menetleveleken -> eltérés a riportban:
    ('omv', CURRENT_DATE - 14, 'DEMO Motorină',  85.0,  480.00),
    ('omv', CURRENT_DATE - 2,  'DEMO Motorină',  60.0,  345.00)
  ) AS t(src, d, prod, l, amt)
  ON CONFLICT (company_id, dedup_hash) DO NOTHING;

  -- ── 7) POD-FOTÓK fuvarhoz kötve (1×1 px PNG helykitöltő) ──
  INSERT INTO documents (email_sofer, nume_sofer, tip, file_name, storage_url, order_id, created_at)
  SELECT v_email, v_nume, 'POD', d.fn,
         'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
         d.oid, d.ts
  FROM (VALUES
    ('demo-pod-frankfurt.png', 'CMD-DEMO12', (CURRENT_DATE-16)::timestamp),
    ('demo-pod-budapest.png',  'CMD-DEMO16', (CURRENT_DATE-6)::timestamp),
    ('demo-pod-graz.png',      'CMD-DEMO17', (CURRENT_DATE-4)::timestamp)
  ) AS d(fn, oid, ts)
  WHERE NOT EXISTS (SELECT 1 FROM documents x WHERE x.file_name = d.fn AND x.email_sofer = v_email);

  -- ── 8) GPS KM-ÓRA NAPLÓ (14 nap, napi ~370 km) ──
  INSERT INTO gps_mileage_log (company_id, rendszam, mileage, logged_on)
  SELECT 2, v_truck, 410600 + (14 - g) * 372.5, CURRENT_DATE - g
  FROM generate_series(1, 14) AS g
  ON CONFLICT (company_id, rendszam, logged_on) DO NOTHING;

  RAISE NOTICE 'demo-fleet: minta-adatok beszúrva (sofőr: %, jármű: %)', v_nume, v_truck;
END $$;
