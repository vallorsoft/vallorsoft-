// ============================================================
//  VallorSoft — Generikus dispatcher (/api/execute) — handler-registry
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');

// Domain-handler csoportok összefűzése egyetlen registry-be
const handlers = Object.assign(
  {},
  require('../handlers/auth'),
  require('../handlers/orders'),
  require('../handlers/users'),
  require('../handlers/invites'),
  require('../handlers/fleet'),
  require('../handlers/documents'),
  require('../handlers/dashboard'),
  require('../handlers/developer'),
  require('../handlers/routePlannerHandlers'),
  require('../handlers/hereFeatureHandlers'),
  require('../handlers/billingHandlers'),
  require('../handlers/intakeHandlers'),
);

router.post('/api/execute', requireLogin, async (req, res) => {
  const { functionName, arguments: args } = req.body;
  const handler = handlers[functionName];
  if (handler) {
    // Védőháló: egy handler-en kívüli/elkapatlan hiba ne legyen
    // unhandledRejection (process-leállás), hanem normál hibaválasz.
    try {
      return await handler(req, res, args);
    } catch (err) {
      console.error(`execute handler hiba (${functionName}):`, err);
      if (!res.headersSent) {
        return res.json({ result: { ok: false, err: 'Szerver hiba' } });
      }
      return;
    }
  }
  // Ismeretlen funkcio
  return res.json({ result: { ok: false, err: 'Ismeretlen funkcio: ' + functionName } });
});

module.exports = router;
