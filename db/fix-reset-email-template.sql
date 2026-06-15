-- db/fix-reset-email-template.sql
-- Eltávolítja a hibásan szerkesztett email_sys_reset sablont a developer_settings-ből.
-- A sendResetEmail() ezután a beégetett HTML fallback-re esik vissza (services/email.js).
-- Miért: a korábban mentett sablon Markdown [url](url) szintaxist tartalmazott, ami
-- HTML e-mailben nem renderel — a link kattinthatatlan volt.
DELETE FROM developer_settings WHERE key = 'email_sys_reset';
