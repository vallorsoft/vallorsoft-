-- db/zz-plan-features-bilingual-final.sql
-- VÉGSŐ, mérvadó beállítás a csomag-feature listákra: kétnyelvű JSONB objektumok.
-- A fájlnév szándékosan 'zz-' előtagú, hogy a migráció-futtató ABC-sorrendjében
-- MINDEN korábbi feature-állító migráció UTÁN fusson (package-setup*.sql egynyelvű
-- magyar stringeket írt; ez felülírja kétnyelvű {ro,hu} objektumokra), így a
-- landing árazás a kiválasztott nyelven (alap: RO) jelenik meg — nem keveredik a
-- két nyelv. Idempotens (mindig a helyes adatot írja).

UPDATE subscription_plans SET features = '[
  {"ro":"Gestionare curse & comenzi","hu":"Fuvar kiírás & kezelés"},
  {"ro":"Scrisori de trăsură & CMR","hu":"Fuvarlevelek & CMR"},
  {"ro":"Gestionare șoferi & vehicule","hu":"Sofőrök & járművek kezelése"},
  {"ro":"Bază de date clienți","hu":"Ügyfelek adatbázis"},
  {"ro":"Statistici de bază","hu":"Alap statisztika"}
]'::jsonb WHERE sort_order = 1;

UPDATE subscription_plans SET features = '[
  {"ro":"Tot din Alap +","hu":"Minden Alap +"},
  {"ro":"Chat intern","hu":"Belső chat"},
  {"ro":"Tablă de planificare (Gantt)","hu":"Tervezőtábla (Gantt)"},
  {"ro":"Integrare GPS (hartă live)","hu":"GPS integráció (live térkép)"},
  {"ro":"Integrare facturare (e-Factura)","hu":"Számlázó integráció (e-Factura)"},
  {"ro":"Estimare taxe & planificare rute","hu":"Útdíj-becslés & útvonaltervezés"},
  {"ro":"Comenzi primite","hu":"Beérkező megrendelések"},
  {"ro":"Expirări & alerte","hu":"Lejáratok & riasztások"},
  {"ro":"Rapoarte financiare","hu":"Pénzügyi riportok"}
]'::jsonb WHERE sort_order = 2;

UPDATE subscription_plans SET features = '[
  {"ro":"Tot din Standard +","hu":"Minden Standard +"},
  {"ro":"Portal clienți","hu":"Ügyfél-portál"},
  {"ro":"Portal subcontractori","hu":"Alvállalkozói portál"},
  {"ro":"Radar de întoarcere","hu":"Visszfuvar-radar"},
  {"ro":"Procesare documente AI","hu":"AI dokumentum-feldolgozás"},
  {"ro":"Modul depozit","hu":"Raktár modul"},
  {"ro":"Rol contabil","hu":"Könyvelő szerepkör"}
]'::jsonb WHERE sort_order = 3;

UPDATE subscription_plans SET features = '[
  {"ro":"Tot din Pro +","hu":"Minden Pro +"},
  {"ro":"Analiză consum & utilizare vehicule","hu":"Fogyasztás & jármű kihasználtság elemzés"},
  {"ro":"Raport performanță șoferi","hu":"Sofőr teljesítmény riport"},
  {"ro":"Import card combustibil","hu":"Üzemanyagkártya-import"},
  {"ro":"Sumar lunar e-mail","hu":"Havi e-mail összefoglaló"},
  {"ro":"Setări personalizate","hu":"Egyedi beállítások"},
  {"ro":"Suport dedicat","hu":"Dedikált support"}
]'::jsonb WHERE sort_order = 4;
