-- ------------------------------------------------------------
--  users.last_login — a fő belépés (Admin/Manager/Sofer/Konyvelo/dev)
--  utolsó belépési időbélyege. A portál-userek (client_users/carrier_users)
--  már rendelkeznek last_login mezővel; ez a fő users táblát egészíti ki,
--  a developer cégenkénti hozzáférés-statisztikájához ("ki mikor lépett be").
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
