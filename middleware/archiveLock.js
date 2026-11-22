// middleware/archiveLock.js — az éves dokumentum-archívum határidejének utolsó 5
// napjában (és lejárat után) az Admin/Manager felhasználónak CSAK az archívum
// letöltése és a kód visszaigazolása engedélyezett (lib/docArchive).
// A sofőr, a portálok és a developer nincs zárolva.
const arch = require('../lib/docArchive');

const LOCKED_ROLES = new Set(['Admin', 'Manager']);
const ALLOWED_FUNCS = new Set(['authMe', 'authLogout', 'getMyFeatures', 'docArchiveStatus', 'docArchiveConfirm', 'docArchiveQuote', 'docArchiveOrder',
  'getMySubscription', 'getMyLegalPending']);
const ALLOWED_PATHS = [/^\/api\/doc-archive\//, /^\/api\/legal\//, /^\/api\/me$/, /^\/api\/logout$/, /^\/api\/push\/(vapid|public)/];
const MSG = 'Arhiva documentelor trebuie descărcată. Până la descărcarea și confirmarea arhivei nu poți face altceva.';

async function archiveLock(req, res, next) {
  try {
    const u = req.session && req.session.user;
    if (!u || !u.company_id || u.is_dev || !LOCKED_ROLES.has(u.pozicio)) return next();
    if (!req.path.startsWith('/api/')) return next();
    if (ALLOWED_PATHS.some((re) => re.test(req.path))) return next();
    if (req.path === '/api/execute' && req.body && ALLOWED_FUNCS.has(req.body.functionName)) return next();
    if (!(await arch.isLocked(u.company_id))) return next();
    if (req.path === '/api/execute') {
      return res.status(423).json({ result: { ok: false, err: MSG, archive_lock: true } });
    }
    return res.status(423).json({ success: false, ok: false, message: MSG, err: MSG, archive_lock: true });
  } catch (_) {
    return next();
  }
}

module.exports = { archiveLock, ALLOWED_FUNCS };
