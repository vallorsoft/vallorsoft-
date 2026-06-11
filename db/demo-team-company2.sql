-- ============================================================
--  VallorSoft — DEMO csapat-bővítés a 2-es céghez (egyszer fut le)
--   1. Második belső sofőr: Norbi (petonorbi96@gmail.com) —
--      jelszó: Demo1234 (bcrypt hash-ként beégetve, be tud lépni)
--   2. Második vontató: CV104VLR (Volvo, 2022)
--   3. Sofőr↔jármű hozzárendelések (B104VLR → 1. sofőr, CV104VLR → Norbi)
--   4. Két KÜLSŐ sofőr: Jani (Proba srl) + Mircea (SpeedCargo SRL)
--   5. Új fuvarok: Norbi fuvarjai + ELKEZDETT (In Curs) fuvarok SOFŐR
--      NÉLKÜL (⚠️ jelzés) + külsős fuvarok a két külső sofőrrel
--   6. Norbi menetlevele + GPS km-napló a CV104VLR-re
--  Idempotens; ha nincs 2-es cég, csendben kimarad.
--  TÖRLÉS: a CMD-DEMO% / MT-DEMO% sorok + a 'DEMO%' nota-jú külsősök,
--  a demo user: DELETE FROM users WHERE email='petonorbi96@gmail.com';
-- ============================================================

DO $$
DECLARE
  v_email1 TEXT; v_nume1 TEXT; v_truck1 TEXT;
  v_email2 TEXT := 'petonorbi96@gmail.com'; v_nume2 TEXT := 'Norbi';
  v_truck2 TEXT := 'CV104VLR';
  v_ext1 INTEGER; v_ext2 INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = 2) THEN
    RAISE NOTICE 'demo-team: nincs 2-es cég, kihagyva'; RETURN;
  END IF;

  -- 1. sofőr + 1. jármű felkutatása (mint a korábbi seedekben)
  SELECT email, nume INTO v_email1, v_nume1 FROM users
   WHERE company_id = 2 AND pozicio = 'Sofer'
     AND (nume ILIKE '%lorincz%' OR nume ILIKE '%peto%' OR nume ILIKE '%pető%')
     AND email <> v_email2 LIMIT 1;
  SELECT rendszam INTO v_truck1 FROM vehicles
   WHERE company_id = 2 AND tip = 'Vontato'
     AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) = 'B104VLR' LIMIT 1;

  -- ── 1) Norbi (belső sofőr) — jelszó: Demo1234 ──
  INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id)
  SELECT 'Norbi', v_email2, '+40762611349', 'Sofer',
         '$2b$10$rsten3UtS1dM6zXZ9By5LuUIRFGsLe9aXGtd0daxYrlEt1x4JWHV6', 2
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = v_email2);

  -- ── 2) CV104VLR (Volvo, 2022) ──
  INSERT INTO vehicles (rendszam, tip, marca, model, an, activ, company_id, fuel_per_100km)
  VALUES ('CV104VLR', 'Vontato', 'Volvo', NULL, 2022, TRUE, 2, 27.5)
  ON CONFLICT (company_id, rendszam) DO NOTHING;

  -- ── 3) Sofőr↔jármű hozzárendelések ──
  UPDATE vehicles SET assigned_driver_email = v_email2
   WHERE company_id = 2 AND rendszam = 'CV104VLR' AND assigned_driver_email IS NULL;
  IF v_email1 IS NOT NULL AND v_truck1 IS NOT NULL THEN
    UPDATE vehicles SET assigned_driver_email = v_email1
     WHERE company_id = 2 AND rendszam = v_truck1 AND assigned_driver_email IS NULL;
  END IF;

  -- ── 4) Két külső sofőr ──
  INSERT INTO external_drivers (nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, company_id)
  SELECT 'Jani', 'Proba srl', '075', 'pelda@email.com', 'GJ17VGG', 'GJ20VGG', 'DEMO külső sofőr', 2
  WHERE NOT EXISTS (SELECT 1 FROM external_drivers WHERE company_id = 2 AND nume = 'Jani' AND firma = 'Proba srl');
  INSERT INTO external_drivers (nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, company_id)
  SELECT 'Mircea Dobre', 'SpeedCargo SRL', '+40 744 222 333', 'dispo@speedcargo-demo.ro', 'GJ55KLM', 'GJ56KLM', 'DEMO külső sofőr', 2
  WHERE NOT EXISTS (SELECT 1 FROM external_drivers WHERE company_id = 2 AND firma = 'SpeedCargo SRL');
  SELECT id INTO v_ext1 FROM external_drivers WHERE company_id = 2 AND nume = 'Jani' AND firma = 'Proba srl' LIMIT 1;
  SELECT id INTO v_ext2 FROM external_drivers WHERE company_id = 2 AND firma = 'SpeedCargo SRL' LIMIT 1;

  -- ── 5) Új fuvarok ──
  INSERT INTO orders (id, client, ref, loc_incarcare, loc_descarcare,
                      data_incarcare, data_descarcare, pret, km,
                      sofer_type, email_sofer, nume_sofer, firma_extern, telefon_extern, external_driver_id,
                      rendszam_camion, status, finalized_at,
                      payment_status, paid_amount, paid_at, company_id, created_at)
  VALUES
  -- Norbi + CV104VLR
  ('CMD-DEMO21','Kaufland Logistics SRL','DEMO-21','Cluj-Napoca','Hamburg',
   CURRENT_DATE+1, CURRENT_DATE+3, 2300, 1500, 'Intern', v_email2, v_nume2, NULL,NULL,NULL,
   'CV104VLR','Alocat',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),
  ('CMD-DEMO22','Profi Rom Food','DEMO-22','București','Köln',
   CURRENT_DATE-1, CURRENT_DATE+1, 2500, 1900, 'Intern', v_email2, v_nume2, NULL,NULL,NULL,
   'CV104VLR','In Curs',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '3 days'),
  ('CMD-DEMO23','DedeMan','DEMO-23','Oradea','Praha',
   CURRENT_DATE-7, CURRENT_DATE-5, 1300, 820, 'Intern', v_email2, v_nume2, NULL,NULL,NULL,
   'CV104VLR','Finalizat',(CURRENT_DATE-5)::timestamp,'paid',1300,(CURRENT_DATE-2)::timestamp, 2, NOW()-INTERVAL '9 days'),
  -- ELKEZDETT munkák SOFŐR NÉLKÜL (⚠️ — a tervezőn és a listán is látszik)
  ('CMD-DEMO24','Arabesque SRL','DEMO-24','Sibiu','Stuttgart',
   CURRENT_DATE, CURRENT_DATE+2, 2100, 1450, NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,'In Curs',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '2 days'),
  ('CMD-DEMO25','Mobexpert','DEMO-25','Pitești','Bologna',
   CURRENT_DATE+1, CURRENT_DATE+3, 1950, 1300, NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,'In Curs',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),
  -- Külsős fuvarok a két külső sofőrrel
  ('CMD-DEMO26','Selgros','DEMO-26','Cluj-Napoca','Sofia',
   CURRENT_DATE+2, CURRENT_DATE+4, 1100, 650, 'Extern', NULL, 'Jani', 'Proba srl', '075', v_ext1,
   'GJ17VGG','Extern',NULL,'unpaid',0,NULL, 2, NOW()),
  ('CMD-DEMO27','Continental Aut.','DEMO-27','Arad','Praha',
   CURRENT_DATE+4, CURRENT_DATE+5, 1250, 720, 'Extern', NULL, 'Mircea Dobre', 'SpeedCargo SRL', '+40 744 222 333', v_ext2,
   'GJ55KLM','Extern',NULL,'unpaid',0,NULL, 2, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ── 6) Norbi menetlevele (a CMD-DEMO23-hoz) ──
  INSERT INTO fuvarlevelek (id, file_name, data_completare, email_sofer, nume_sofer,
    numar_camion, numar_remorca, numar_fisa, km_inceput, km_sfarsit, total_km,
    loc_plecare, loc_sosire, diurna_externa, diurna_interna,
    cant_inceput, cant_sfarsit, motorina_folosit, total_alim, consum_100,
    alte_mentiuni, alimentari, achizitii, puncte, order_ids)
  VALUES
  ('MT-DEMO07','mt-demo-07.pdf',(CURRENT_DATE-5)::timestamp, v_email2, v_nume2,
   'CV104VLR','CV09TRL','MT-2026-9007', 128400, 130080, 1680,
   'Oradea','Praha', 3, 0, 240, 195, 455, 410, 27.1,
   'DEMO menetlevél (Norbi)',
   '[{"loc":"MOL Borș","tip":"Motorină","litru":250,"km":128600,"plata":"DKV","suma":1380},
     {"loc":"Shell Brno","tip":"Motorină","litru":160,"km":129700,"plata":"Card","suma":930}]'::jsonb,
   '[{"produs":"Parkolás D1","loc":"Brno","pret":85,"plata":"Cash"},
     {"produs":"Vignetta CZ","loc":"Brno","pret":120,"plata":"Card"}]'::jsonb,
   '[{"tip":"Încărcare","loc":"Oradea","data":"demo"},{"tip":"Descărcare","loc":"Praha","data":"demo"}]'::jsonb,
   '["CMD-DEMO23"]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- GPS km-napló a CV104VLR-re (10 nap)
  INSERT INTO gps_mileage_log (company_id, rendszam, mileage, logged_on)
  SELECT 2, 'CV104VLR', 127500 + (10 - g) * 340, CURRENT_DATE - g
  FROM generate_series(1, 10) AS g
  ON CONFLICT (company_id, rendszam, logged_on) DO NOTHING;

  RAISE NOTICE 'demo-team: Norbi + CV104VLR + 2 külső sofőr + 7 fuvar beszúrva';
END $$;
