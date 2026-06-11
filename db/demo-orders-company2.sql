-- ============================================================
--  VallorSoft — DEMO fuvarok a 2-es céghez (egyszer fut le)
--  20 fuvar random, de ÉLETSZERŰ részletekkel, úgy összerakva,
--  hogy a teljes funkció-paletta látszódjon:
--   - kiosztatlan fuvarok (tervező "Kiosztásra vár" + Visszfuvar-radar)
--   - sofőrre/járműre kiosztott, úton lévő, KÜLSŐS fuvar
--   - szándékos ÜTKÖZÉS egy járművön (tervező ⚠️ jelzés)
--   - sofőr nélküli jármű-kiosztás (⚠️ nincs sofőr)
--   - Finalizat fuvarok: fizetett / részfizetett / kintlévő / LEJÁRT
--   - múlt/jelen/jövő dátumok (tervező-idővonal + statisztika)
--  Sofőr: névre keres ('%lorincz%' / '%peto%', company 2, Sofer) —
--  ha nincs, a cég bármely sofőrje. Jármű: B104VLR, ha nincs, az első
--  vontató. Ha a 2-es cég nem létezik, az egész csendben kimarad.
--  TÖRLÉS utólag:  DELETE FROM orders WHERE id LIKE 'CMD-DEMO%';
-- ============================================================

DO $$
DECLARE
  v_email TEXT; v_nume TEXT; v_truck TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = 2) THEN
    RAISE NOTICE 'demo-orders: nincs 2-es cég, kihagyva';
    RETURN;
  END IF;

  SELECT email, nume INTO v_email, v_nume FROM users
   WHERE company_id = 2 AND pozicio = 'Sofer'
     AND (nume ILIKE '%lorincz%' OR nume ILIKE '%peto%' OR nume ILIKE '%pető%')
   LIMIT 1;
  IF v_email IS NULL THEN
    SELECT email, nume INTO v_email, v_nume FROM users
     WHERE company_id = 2 AND pozicio = 'Sofer' LIMIT 1;
  END IF;

  SELECT rendszam INTO v_truck FROM vehicles
   WHERE company_id = 2 AND tip = 'Vontato'
     AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) = 'B104VLR' LIMIT 1;
  IF v_truck IS NULL THEN
    SELECT rendszam INTO v_truck FROM vehicles
     WHERE company_id = 2 AND tip = 'Vontato' AND activ = TRUE LIMIT 1;
  END IF;

  INSERT INTO orders (id, client, ref, loc_incarcare, loc_descarcare,
                      data_incarcare, data_descarcare, pret, km,
                      sofer_type, email_sofer, nume_sofer, firma_extern, telefon_extern,
                      rendszam_camion, status, finalized_at,
                      payment_status, paid_amount, paid_at,
                      company_id, created_at)
  VALUES
  -- ── KIOSZTATLAN (tervező-pool + Visszfuvar-radar célpontok) ──
  ('CMD-DEMO01','Kaufland Logistics SRL','DEMO-01','Cluj-Napoca','Wien',
   CURRENT_DATE+2, CURRENT_DATE+3, 1450, 780, NULL,NULL,NULL,NULL,NULL,
   NULL,'Disponibil',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),
  ('CMD-DEMO02','Profi Rom Food','DEMO-02','Oradea','München',
   NULL, NULL, 1900, 930, NULL,NULL,NULL,NULL,NULL,
   NULL,'Disponibil',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '2 days'),
  ('CMD-DEMO03','Arabesque SRL','DEMO-03','Timișoara','Budapest',
   CURRENT_DATE+5, CURRENT_DATE+6, 850, 320, NULL,NULL,NULL,NULL,NULL,
   NULL,'Disponibil',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),
  ('CMD-DEMO04','Mobexpert','DEMO-04','București','Praha',
   CURRENT_DATE+8, CURRENT_DATE+9, 2100, 1080, NULL,NULL,NULL,NULL,NULL,
   NULL,'Disponibil',NULL,'unpaid',0,NULL, 2, NOW()),
  ('CMD-DEMO20','AgroTrans Vest','DEMO-20','München','Cluj-Napoca',
   CURRENT_DATE+12, CURRENT_DATE+13, 1500, 890, NULL,NULL,NULL,NULL,NULL,
   NULL,'Disponibil',NULL,'unpaid',0,NULL, 2, NOW()),

  -- ── KIOSZTOTT (Alocat) — sofőr + jármű / csak az egyik ──
  ('CMD-DEMO05','DedeMan','DEMO-05','Cluj-Napoca','Bratislava',
   CURRENT_DATE, CURRENT_DATE+1, 1200, 520, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Alocat',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '3 days'),
  ('CMD-DEMO06','Lukoil Logistics','DEMO-06','Wien','Cluj-Napoca',
   CURRENT_DATE+3, CURRENT_DATE+4, 1350, 640, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Alocat',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '2 days'),
  ('CMD-DEMO07','Nokian Tyres','DEMO-07','Budapest','Arad',
   CURRENT_DATE+6, CURRENT_DATE+7, 700, 280, 'Intern',v_email,v_nume,NULL,NULL,
   NULL,'Alocat',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),
  ('CMD-DEMO08','Banca Transilvania Log.','DEMO-08','Arad','Milano',
   CURRENT_DATE+10, CURRENT_DATE+11, 2400, 1150, NULL,NULL,NULL,NULL,NULL,
   v_truck,'Alocat',NULL,'unpaid',0,NULL, 2, NOW()),

  -- ── ÚTON (In Curs) — a kettő ÁTFEDŐ ugyanazon a járművön → ⚠️ ütközés ──
  ('CMD-DEMO09','Continental Aut.','DEMO-09','Oradea','Berlin',
   CURRENT_DATE-1, CURRENT_DATE+1, 2200, 1100, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'In Curs',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '4 days'),
  ('CMD-DEMO10','Bosch Rexroth','DEMO-10','Satu Mare','Paris',
   CURRENT_DATE, CURRENT_DATE+2, 2600, 1700, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'In Curs',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '3 days'),

  -- ── KÜLSŐS fuvar (Extern alvállalkozóval) ──
  ('CMD-DEMO11','Selgros','DEMO-11','Cluj-Napoca','Iași',
   CURRENT_DATE+1, CURRENT_DATE+2, 900, 430, 'Extern',NULL,'Vasile Marian','TransRapid SRL','+40 745 111 222',
   NULL,'Extern',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '1 day'),

  -- ── TELJESÍTETT (Finalizat) — fizetett / részfizetett / kintlévő / LEJÁRT ──
  ('CMD-DEMO12','Kaufland Logistics SRL','DEMO-12','Cluj-Napoca','Frankfurt',
   CURRENT_DATE-18, CURRENT_DATE-16, 1600, 900, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-16)::timestamp,'paid',1600,(CURRENT_DATE-9)::timestamp, 2, NOW()-INTERVAL '20 days'),
  ('CMD-DEMO13','Profi Rom Food','DEMO-13','Deva','Wien',
   CURRENT_DATE-25, CURRENT_DATE-23, 1100, 610, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-23)::timestamp,'paid',1100,(CURRENT_DATE-12)::timestamp, 2, NOW()-INTERVAL '27 days'),
  ('CMD-DEMO14','Mobexpert','DEMO-14','Oradea','Linz',
   CURRENT_DATE-12, CURRENT_DATE-10, 1400, 720, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-10)::timestamp,'partial',500,(CURRENT_DATE-3)::timestamp, 2, NOW()-INTERVAL '14 days'),
  ('CMD-DEMO15','Arabesque SRL','DEMO-15','Brașov','Madrid',
   CURRENT_DATE-40, CURRENT_DATE-37, 2900, 2400, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-37)::timestamp,'unpaid',0,NULL, 2, NOW()-INTERVAL '42 days'),
  ('CMD-DEMO16','DedeMan','DEMO-16','Cluj-Napoca','Budapest',
   CURRENT_DATE-8, CURRENT_DATE-6, 980, 460, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-6)::timestamp,'unpaid',0,NULL, 2, NOW()-INTERVAL '10 days'),
  ('CMD-DEMO17','Continental Aut.','DEMO-17','Timișoara','Graz',
   CURRENT_DATE-5, CURRENT_DATE-4, 1250, 540, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-4)::timestamp,'paid',1250,(CURRENT_DATE-1)::timestamp, 2, NOW()-INTERVAL '7 days'),
  ('CMD-DEMO18','Selgros','DEMO-18','Bacău','Lyon',
   CURRENT_DATE-33, CURRENT_DATE-30, 2000, 1900, 'Intern',v_email,v_nume,NULL,NULL,
   v_truck,'Finalizat',(CURRENT_DATE-30)::timestamp,'partial',800,(CURRENT_DATE-20)::timestamp, 2, NOW()-INTERVAL '35 days'),

  -- ── TÖRÖLT ──
  ('CMD-DEMO19','Bosch Rexroth','DEMO-19','Cluj-Napoca','Oradea',
   CURRENT_DATE-3, CURRENT_DATE-3, 760, 150, NULL,NULL,NULL,NULL,NULL,
   NULL,'Anulat',NULL,'unpaid',0,NULL, 2, NOW()-INTERVAL '5 days')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'demo-orders: 20 demo fuvar beszúrva (cég #2, sofőr: %, jármű: %)', v_nume, v_truck;
END $$;
