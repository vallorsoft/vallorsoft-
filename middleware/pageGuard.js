// ============================================================
//  VallorSoft — Oldal-szintű jogosultság: requirePageLogin / requirePageRole
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
function requirePageLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requirePageRole(...roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.pozicio) && !req.session.user.is_dev) {
      // Helyes oldalra kuldjuk vissza
      const p = req.session.user.pozicio;
      if (p === 'Admin') return res.redirect('/admin');
      if (p === 'Manager') return res.redirect('/manager');
      return res.redirect('/sofer');
    }
    next();
  };
}

module.exports = { requirePageLogin, requirePageRole };
