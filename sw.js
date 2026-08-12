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
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `osu-shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `osu-images-${CACHE_VERSION}`;
const FONT_CACHE = `osu-fonts-${CACHE_VERSION}`;
const KNOWN_CACHES = new Set([SHELL_CACHE, IMAGE_CACHE, FONT_CACHE]);

const SHELL_ASSETS = [
    '/', '/index.html', '/manifest.json',
    '/css/base.css', '/css/theme.css', '/css/particles.css', '/css/osu.css',
    '/js/main.js', '/js/osu.js', '/js/public-collections.js', '/js/skins.js',
    '/js/updates.js', '/js/tournaments.js', '/js/notifications.js', '/js/feedback.js', '/js/celebrate.js',
    '/js/icons.js', '/js/theme.js', '/js/particles.js', '/js/pwa.js', '/js/i18n.js',
    '/js/i18n/zh.js', '/js/i18n/en.js', '/js/i18n/ja.js', '/js/i18n/ko.js',
    '/js/i18n/ru.js', '/js/i18n/fr.js', '/js/i18n/es.js', '/js/i18n/de.js',
    '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
    '/assets/icons/icon-maskable-512.png', '/assets/icons/apple-touch-icon.png',
    '/assets/icons/osu-logo.svg', '/assets/icons/mode-standard.svg',
    '/assets/icons/mode-taiko.svg', '/assets/icons/mode-catch.svg', '/assets/icons/mode-mania.svg',
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

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => !KNOWN_CACHES.has(k)).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

async function networkFirstShell(request) {
    try {
        const res = await fetch(request);
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

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, res.clone());
    }
    return res;
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

    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(cacheFirst(request, FONT_CACHE));
        return;
    }

    if (request.destination === 'image') {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    if (url.origin === self.location.origin &&
        (request.mode === 'navigate' || ['script', 'style'].includes(request.destination) || SHELL_ASSETS.includes(url.pathname))) {
        event.respondWith(networkFirstShell(request));
    }
});
