/* ============================================================
   VallorSoft — Web Push Client
   Minden oldalon betöltödik (admin, manager, sofer)
   ============================================================ */

(function() {
  'use strict';

  var VS_PUSH = window.VS_PUSH = {};

  var _swReg        = null;
  var _subscription = null;
  var _vapidKey     = null;
  var _myEmail      = null;
  var _myRole       = null;

  /* ---------- Utils ---------- */
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw     = atob(base64);
    var output  = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  /* ---------- Init ---------- */
  VS_PUSH.init = function(email, role) {
    _myEmail = email;
    _myRole  = role;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (window.VS_PUSH_DEBUG) console.log('[Push] Platform nem tamogatja a push ertesiteseket');
      return;
    }

    // VAPID kulcs lekeres
    fetch('/api/push-vapid-key')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok || !d.key) {
          if (window.VS_PUSH_DEBUG) console.log('[Push] VAPID kulcs nem elerheto - push kikapcsolva');
          return;
        }
        _vapidKey = d.key;

        // Service Worker regisztralasa (ha meg nincs)
        return navigator.serviceWorker.register('/sw.js')
          .then(function(reg) {
            _swReg = reg;
            if (window.VS_PUSH_DEBUG) console.log('[Push] SW regisztralt');
            return reg.pushManager.getSubscription();
          })
          .then(function(sub) {
            if (sub) {
              _subscription = sub;
              VS_PUSH._saveToServer(sub);
              if (window.VS_PUSH_DEBUG) console.log('[Push] Meglevo subscription talalhato');
            } else {
              VS_PUSH._askPermission();
            }
          });
      })
      .catch(function(err) {
        if (window.VS_PUSH_DEBUG) console.log('[Push] Init hiba:', err);
      });
  };

  /* ---------- Engedely keres ---------- */
  VS_PUSH._askPermission = function() {
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'granted') {
      VS_PUSH._subscribe();
      return;
    }

    // Ha mar elutasitotta (7 napon belul), ne zavarja ujra
    try {
      var dismissed = localStorage.getItem('vs_push_dismissed');
      if (dismissed && (Date.now() - parseInt(dismissed, 10)) < 7 * 24 * 60 * 60 * 1000) return;
    } catch(e) {}

    // 4 masodperc utan kerjuk (ne azonnal betoltes utan)
    setTimeout(function() {
      VS_PUSH._showBanner();
    }, 4000);
  };

  /* ---------- Push banner (sajat UI) ---------- */
  VS_PUSH._showBanner = function() {
    if (document.getElementById('vs-push-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'vs-push-banner';
    banner.style.cssText = [
      'position:fixed',
      'bottom:80px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#141c25',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:16px',
      'padding:16px 20px',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'gap:14px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.7)',
      'max-width:360px',
      'width:calc(100vw - 32px)',
      'animation:vsSlideUp .3s ease'
    ].join(';');

    banner.innerHTML = [
      '<style>',
      '@keyframes vsSlideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
      '</style>',
      '<div style="font-size:28px;flex-shrink:0;">🔔</div>',
      '<div style="flex:1;">',
      '  <div style="font-weight:700;color:#fff;font-size:14px;margin-bottom:4px;">Üzenet értesítések</div>',
      '  <div style="font-size:12px;color:#8a97a8;">Kapjon értesítést amikor új üzenete érkezik</div>',
      '</div>',
      '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">',
      '  <button id="vs-push-yes" style="background:linear-gradient(180deg,#fff,#d9dee6);color:#0a0f15;border:none;border-radius:8px;padding:8px 14px;font-weight:700;font-size:12px;cursor:pointer;">Igen</button>',
      '  <button id="vs-push-no"  style="background:transparent;color:#8a97a8;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;">Nem</button>',
      '</div>'
    ].join('');

    document.body.appendChild(banner);

    document.getElementById('vs-push-yes').onclick = function() {
      banner.remove();
      VS_PUSH._subscribe();
    };
    document.getElementById('vs-push-no').onclick = function() {
      banner.remove();
      try { localStorage.setItem('vs_push_dismissed', Date.now()); } catch(e) {}
    };

    // Auto-eltunes 15 masodperc utan
    setTimeout(function() { if (banner.parentNode) banner.remove(); }, 15000);
  };

  /* ---------- Feliratkozas ---------- */
  VS_PUSH._subscribe = function() {
    if (!_swReg || !_vapidKey) return;

    Notification.requestPermission().then(function(perm) {
      if (perm !== 'granted') {
        if (window.VS_PUSH_DEBUG) console.log('[Push] Engedely megtagadva');
        return;
      }
      _swReg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(_vapidKey)
      })
      .then(function(sub) {
        _subscription = sub;
        VS_PUSH._saveToServer(sub);
        if (window.VS_PUSH_DEBUG) console.log('[Push] Sikeresen feliratkozva');
      })
      .catch(function(err) {
        console.error('[Push] Feliratkozasi hiba:', err);
      });
    });
  };

  /* ---------- Mentese szervernek ---------- */
  VS_PUSH._saveToServer = function(sub) {
    fetch('/api/push-subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ subscription: sub })
    }).catch(function(err) {
      console.error('[Push] Szerver mentes hiba:', err);
    });
  };

  /* ---------- Leiratkozas ---------- */
  VS_PUSH.unsubscribe = function() {
    if (!_subscription) return;
    var endpoint = _subscription.endpoint;
    _subscription.unsubscribe().then(function() {
      _subscription = null;
      fetch('/api/push-unsubscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: endpoint })
      });
    });
  };

  /* ---------- Chat uzenet kuldese utan hivd ezt ---------- */
  VS_PUSH.notifyChat = function(opts) {
    fetch('/api/chat-notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(opts)
    }).catch(function() {});
  };

  /* ---------- SW uzenetek fogadasa (fokuszalas utan) ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'CHAT_NOTIFICATION_CLICK') {
        var room = e.data.room;
        if (room && typeof activateTab === 'function') {
          activateTab('chat');
          setTimeout(function() {
            if (typeof openChatRoom === 'function') openChatRoom(room);
          }, 600);
        }
      }
    });
  }

})();