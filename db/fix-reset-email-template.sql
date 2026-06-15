-- db/fix-reset-email-template.sql
-- Eltávolítja az összes hibásan szerkesztett rendszer-email sablont a developer_settings-ből.
-- A levelező függvények (sendInviteEmail, sendResetEmail, welcome, trial_expiry) ezután
-- a beégetett, helyes HTML sablonokra esnek vissza (services/email.js, services/scheduler.js).
-- Miért: a korábban mentett sablonok Markdown [url](url) szintaxist tartalmaztak,
-- ami HTML e-mailben szó szerint jelenik meg — a linkek kattinthatatlanok voltak.
-- Jövőre: {{reset_url_btn}}, {{reset_url_link}}, {{invite_url_btn}} HTML-változók
-- a developer.html-ből szerkeszthető sablonoknál már helyesen renderelnek.
DELETE FROM developer_settings
WHERE key IN ('email_sys_reset', 'email_sys_invite', 'email_sys_welcome', 'email_sys_trial_expiry');
