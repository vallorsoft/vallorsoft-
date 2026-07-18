-- ============================================================
--  VallorSoft — Ideiglenes WhatsApp-alapú chat: cég WhatsApp-szám
--
--  A Firebase-es belső chat átmeneti kiváltása: a sofőrök a chat-kártyáról
--  a manager/admin által beállított WhatsApp-számra ugranak (wa.me/…).
--  A manager/admin oldalon a chat pane a saját sofőrjeit listázza; kattintva
--  a sofőr `users.tel` mezője alapján nyílik a WhatsApp.
--
--  Ez a migráció EGYETLEN oszlopot ad hozzá a `companies` táblához.
--  NEM változtatjuk a meglévő `telefon` mezőt (cég kapcsolattartó telefonja):
--  a WhatsApp-szám az operatív, sofőrnek megjelenített szám (más lehet).
--
--  Inkrementális, IDEMPOTENS.
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(30);
