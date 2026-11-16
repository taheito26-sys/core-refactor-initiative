/*
 * Push notification handlers, imported by the generated Workbox service worker
 * (see `workbox.importScripts` in vite.config.ts). Keeping this in /public
 * means it is served as-is and does not depend on the app bundle being loaded.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const data = payload.data || {};
  const title = payload.title || 'The Tracker';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.notification_id ? `notif-${data.notification_id}` : 'tracker-notification',
    renotify: Boolean(data.notification_id),
    data,
    timestamp: Date.now(),
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);

    // Badging API (Chromium). Harmless where it is not supported.
    if (payload.badge && self.navigator && 'setAppBadge' in self.navigator) {
      try {
        await self.navigator.setAppBadge(Number(payload.badge) || 1);
      } catch {
        /* ignore */
      }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = event.notification.data?.path || '/notifications';

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clientList) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(targetPath);
          } catch {
            /* focus alone is still useful */
          }
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetPath);
    }
  })());
});

// Browsers rotate push endpoints occasionally. Ask any open tab to re-subscribe
// and save the new endpoint; the server deletes the old one when it goes stale.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      client.postMessage({ type: 'push-subscription-changed' });
    }
  })());
});
