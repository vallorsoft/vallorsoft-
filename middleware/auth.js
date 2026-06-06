// ============================================================
//  VallorSoft — Auth middleware: requireLogin / requireRole
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
  }
  next();
}

// Middleware: csak adott szerepkort enged tovabb
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
    }
    if (!roles.includes(req.session.user.pozicio)) {
      return res.status(403).json({ success: false, message: 'Nincs jogosultsag' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
