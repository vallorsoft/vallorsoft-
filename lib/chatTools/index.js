// ============================================================
//  VallorSoft — lib/chatTools/index.js
//  A chat-képességek (tool-ok) EGYETLEN regisztere. Új funkció chatből =
//  új bejegyzés a megfelelő domain-fájlban (a meglévő handlert hívva).
// ============================================================
'use strict';

const core = require('./core');

const DOMAINS = ['nav', 'orders', 'fleet', 'finance', 'more', 'admin', 'people', 'manage', 'undo'];
for (const d of DOMAINS) core.register(require('./' + d));

module.exports = core;
