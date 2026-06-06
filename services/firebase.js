// ============================================================
//  VallorSoft — Firebase Admin inicializálás
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
// Firebase Admin SDK (custom token a chat hitelesiteshez)
let fbAdmin = null;
try {
  fbAdmin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && !fbAdmin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    fbAdmin.initializeApp({
      credential: fbAdmin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL
    });
    console.log('Firebase Admin inicializalva');
  } else if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('FIREBASE_SERVICE_ACCOUNT hianyzik - Firebase custom token nem mukodik');
    fbAdmin = null;
  }
} catch(e) {
  fbAdmin = null;
  console.warn('firebase-admin nincs telepitve');
}

module.exports = fbAdmin;
