// Service worker minimo: rende l'app installabile.
// Non fa caching aggressivo perché l'app dipende da una connessione
// real-time (WebSocket) sempre attiva: niente contenuti offline "falsi".
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // passthrough

// Arriva anche ad app chiusa o schermo spento (finché il browser è vivo in background)
self.addEventListener('push', (event) => {
  let data = { title: "PitComm", body: "Messaggio dall'auto" };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'pitcomm-msg',
      renotify: true,
      requireInteraction: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
