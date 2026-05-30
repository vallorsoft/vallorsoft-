const CACHE = 'vallorsoft-v3';
const PRECACHE = ['/style.css', '/sofer'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ============================================================
//  WEB PUSH — ertesites megjelenitese
// ============================================================
self.addEventListener('push', function(e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch(err) {
    data = { title: 'VallorSoft', body: e.data ? e.data.text() : 'Uj uzenet erkezett' };
  }

  var title   = data.title || 'VallorSoft';
  var options = {
    body:    data.body    || 'Uj uzenet erkezett',
    icon:    data.icon    || '/icon192.png',
    badge:   data.badge   || '/icon192.png',
    tag:     data.tag     || 'vs-chat-' + (data.room || 'general'),
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url:    data.url    || '/',
      room:   data.room   || null,
      role:   data.role   || null,
    },
    actions: [
      { action: 'open',    title: '\uD83D\uDCAC Megnyit' },
      { action: 'dismiss', title: 'Bez\u00E1r'    }
    ]
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// Ertesitesre kattintaskor megnyitja a megfelelo oldalt
self.addEventListener('notificationclick', function(e) {
  e.notification.close();

  if (e.action === 'dismiss') return;

  var data = e.notification.data || {};
  var targetUrl = data.url || '/';

  // Szerepkor alapjan a megfelelo oldalt nyitjuk meg
  if (data.role === 'Sofer')   targetUrl = '/sofer';
  if (data.role === 'Manager') targetUrl = '/manager';
  if (data.role === 'Admin')   targetUrl = '/admin';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wcs) {
      // Ha mar nyitva van a VallorSoft, csak fokuszszuk
      for (var i = 0; i < wcs.length; i++) {
        var wc = wcs[i];
        if (wc.url.indexOf(self.location.origin) === 0) {
          wc.focus();
          wc.postMessage({ type: 'CHAT_NOTIFICATION_CLICK', room: data.room });
          return;
        }
      }
      // Ha nincs nyitva, uj ablak
      return clients.openWindow(targetUrl);
    })
  );
});

// Push subscription valtozott (browser megujitotta)
self.addEventListener('pushsubscriptionchange', function(e) {
  e.waitUntil(
    self.registration.pushManager.subscribe(e.oldSubscription.options)
      .then(function(subscription) {
        return fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription })
        });
      })
  );
});