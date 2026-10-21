/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

self.skipWaiting();
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// app shell for every navigation (offline open), API never cached
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));
// product / quote images from Supabase public storage
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.includes('/object/public/') && /\.(jpe?g|png|webp)$/i.test(url.pathname),
  new CacheFirst({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 864e2 })] }),
);

self.addEventListener('push', event => {
  let d: any = {};
  try { d = event.data?.json() || {}; } catch { d = { title: 'HDS', body: event.data?.text() }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // chat open and in front → the in-app realtime update is enough
    if (wins.some(w => (w as WindowClient).focused && (w as WindowClient).visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'HDS', {
      body: d.body || 'New message', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
      tag: d.tag || 'chat', data: { url: d.url || '/' }, renotify: true,
    } as NotificationOptions);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins[0] as WindowClient | undefined;
    if (w) { await w.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
