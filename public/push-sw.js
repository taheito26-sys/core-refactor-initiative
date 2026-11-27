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
  const title = payload.title || 'Raseed';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.notification_id ? `notif-${data.notification_id}` : 'tracker-notification',
    renotify: Boolean(data.notification_id),
    data,
    timestamp: Date.now(),
  };

  // A waiting Binance P2P order: keep it on screen, vibrate hard, and alert
  // again on every reminder until the merchant acknowledges it.
  if (data.category === 'p2p_order_alert') {
    options.tag = `p2p-order-${data.order_number || data.p2p_alert_id || ''}`;
    options.renotify = true;
    options.requireInteraction = true;
    options.silent = false;
    options.vibrate = [500, 200, 500, 200, 500, 200, 1000];
    if (data.p2p_alert_id && data.p2p_ack_token) {
      options.actions = [
        { action: 'p2p-ack', title: 'تم / Acknowledge' },
        { action: 'open', title: 'فتح / Open' },
      ];
    }
  }

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

  const clickData = event.notification.data || {};
  if (event.action === 'p2p-ack' && clickData.p2p_alert_id && clickData.p2p_ack_token) {
    event.waitUntil(acknowledgeP2PAlert(clickData));
    return;
  }

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

// The push payload carries the functions URL and a per-alert token, so the
// Acknowledge button works without the app being open or signed in here.
async function acknowledgeP2PAlert(data) {
  const base = data.functions_url;
  if (!base) return;
  try {
    await fetch(`${base}/p2p-order-watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ack', alert_id: data.p2p_alert_id, token: data.p2p_ack_token }),
    });
  } catch {
    /* the in-app alert still offers Acknowledge */
  }
}
