// ============================================================
//  Teszt-helper — session fixture middleware
//  A valódi express-session helyett egy beállítható req.session.user-t
//  injektál, hogy a requireLogin / requireRole middleware-eket
//  éles munkamenet nélkül tesztelhessük.
// ============================================================

let _user = null;

// Állítsd be az aktuális (bejelentkezett) felhasználót egy teszthez.
function setUser(u) { _user = u; }

// Middleware, ami a beállított usert teszi a req.session-be.
function sessionMiddleware(req, _res, next) {
  req.session = { user: _user };
  next();
}

// Gyakori fixture-ök.
const fixtures = {
  sofer:   { id: 10, email: 'sofer@ceg.hu',   nume: 'Teszt Sofőr',   pozicio: 'Sofer',   company_id: 1 },
  manager: { id: 20, email: 'manager@ceg.hu', nume: 'Teszt Manager', pozicio: 'Manager', company_id: 1 },
  admin:   { id: 30, email: 'admin@ceg.hu',   nume: 'Teszt Admin',   pozicio: 'Admin',   company_id: 1 },
};

module.exports = { setUser, sessionMiddleware, fixtures };
