/* ===== Service worker — app-shell + runtime image caching =====
   Goal is narrow: your own collection (js/osu.js) is already entirely
   localStorage-backed, so all it needs to render offline is the app shell
   (HTML/CSS/JS) and the beatmap cover/avatar *images* it references — not
   the osu! API itself, which stays network-only (PP lookups, the public
   gallery, etc. are meaningless offline and already fail gracefully via
   their own try/catch + toast, see js/public-collections.js).

   Bump CACHE_VERSION on any shell asset change so activate() evicts the old
   cache — the fetch strategy below is network-first for the shell (so
   normal visits always get the latest code), so this mostly matters for
   forcing a clean slate rather than for staleness. */
const CACHE_VERSION = 'v15';
const SHELL_CACHE = `osu-shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `osu-images-${CACHE_VERSION}`;
const KNOWN_CACHES = new Set([SHELL_CACHE, IMAGE_CACHE]);

/* Only what the collection page needs to render offline in the default
   locale. install' used to addAll() ~45 entries — every feature script,
   all 8 locales, every icon asset — and those ~45 parallel fetches fired
   during the first paint, competing with the page's own resources; that
   was most of the ~1s Lighthouse charged as a cold-load "redirect".
   Everything else caches organically anyway: networkFirstShell() puts
   every script/style it serves into SHELL_CACHE as you hit it, and the
   image handler caches icons/covers on demand. So after one ordinary
   visit the full app is offline-capable — the first paint just isn't
   paying to prefetch all of it up front. */
const SHELL_ASSETS = [
    '/', '/index.html', '/manifest.json',
    '/css/base.css', '/css/theme.css', '/css/particles.css', '/css/osu.css',
    '/js/icons.js', '/js/theme.js', '/js/particles.js', '/js/pwa.js',
    '/js/i18n.js', '/js/i18n/zh.js', '/js/main.js', '/js/osu.js',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS))
    );
    // No unconditional self.skipWaiting() here on purpose: a first-ever
    // install has no old worker to wait behind anyway, and an *update*
    // should stay parked in "waiting" until the visitor actually clicks the
    // 更新網站 button (js/pwa.js), not swap the running page's code out from
    // under it — see the message handler below for how that button's click
    // reaches this worker.
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ===== Web Push =====
   push-cron sends { title, body, url } — see netlify/functions/push-cron.js.
   Clicking the notification focuses an existing tab (navigating it to the
   payload url) or opens a new one. */
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
    const title = data.title || 'osu! Collection';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        tag: data.tag || 'osu-pp',
        data: { url: data.url || '/' },
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) {
            if ('focus' in c) {
                try { await c.navigate(url); } catch { /* cross-origin/opaque — just focus */ }
                return c.focus();
            }
        }
        return self.clients.openWindow(url);
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => !KNOWN_CACHES.has(k)).map(k => caches.delete(k)));
        // Navigation preload: let Chrome fire the network request for a
        // navigation in parallel with this worker booting, instead of the
        // page waiting out SW startup before networkFirstShell() even calls
        // fetch(). That startup wait is what Lighthouse was charging as a
        // ~1s "redirect" on cold loads.
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
        }
        await self.clients.claim();
    })());
});

async function networkFirstShell(request, preloadResponsePromise) {
    try {
        // For navigations this is the response Chrome already started
        // fetching while the worker booted (see navigationPreload above);
        // for everything else it's undefined and we fetch() as normal.
        const res = (preloadResponsePromise && await preloadResponsePromise) || await fetch(request);
        if (res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, res.clone());
        }
        return res;
    } catch {
        const cached = await caches.match(request, { ignoreSearch: true });
        return cached || caches.match('/index.html');
    }
}

/* Cover art / avatars: serve the cached copy immediately if there is one
   (this is what makes a stale collection list feel instant offline), then
   refresh it in the background so next time it's up to date. */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone());
        return res;
    }).catch(() => null);
    return cached || network || fetch(request);
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // The osu! API proxy (Netlify Functions) is never cached — PP, gallery
    // and lookup data must always be live-or-nothing, never a stale replay.
    if (url.pathname.startsWith('/.netlify/functions/')) return;

    if (request.destination === 'image') {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    if (url.origin === self.location.origin &&
        (request.mode === 'navigate' || ['script', 'style'].includes(request.destination) || SHELL_ASSETS.includes(url.pathname))) {
        event.respondWith(networkFirstShell(request, event.preloadResponse));
    }
});
