-- ============================================================
--  VallorSoft — Könyvelő (Konyvelo) szerepkör engedélyezése (idempotens)
--  A users/invites.pozicio CHECK-constraintjét kibővítjük a 'Konyvelo'
--  szerepkörrel. A könyvelőt CSAK az admin hívhatja meg (handlers/invites.js),
--  és a /konyvelo oldalra jut be (dokumentum-hub + SAGA/WinMentor export).
-- ============================================================

ALTER TABLE users   DROP CONSTRAINT IF EXISTS users_pozicio_check;
ALTER TABLE users   ADD  CONSTRAINT users_pozicio_check   CHECK (pozicio IN ('Admin','Manager','Sofer','Konyvelo'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_pozicio_check;
ALTER TABLE invites ADD  CONSTRAINT invites_pozicio_check CHECK (pozicio IN ('Admin','Manager','Sofer','Konyvelo'));
