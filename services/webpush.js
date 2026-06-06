// ============================================================
//  VallorSoft — Web Push inicializálás
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
// Web Push
let webpush = null;
try {
  webpush = require('web-push');
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL || ('mailto:' + (process.env.BREVO_SENDER || 'admin@vallorsoft.hu'));
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
    console.log('Web Push VAPID beallitva');
  } else {
    console.warn('VAPID kulcsok hianyzanak - push ertesitesek nem mukodnek');
    webpush = null;
  }
} catch(e) {
  webpush = null;
  console.warn('web-push nincs telepitve');
}

module.exports = webpush;
