/* ===== PWA install + service worker registration =====
   The service worker (sw.js) makes the already-localStorage-backed
   collection page (js/osu.js) actually renderable offline by caching the
   app shell + beatmap cover/avatar images — see sw.js for why the osu! API
   itself stays out of that cache. This file just wires that up and exposes
   an "加到主畫面" button using the standard beforeinstallprompt flow. */
let swRegistration = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            swRegistration = reg;
            // A worker can already be sitting in "waiting" the moment we
            // register — e.g. this tab was open through a previous deploy
            // and just got refreshed — same situation as updatefound below,
            // just discovered a different way.
            if (reg.waiting) notifySiteUpdateAvailable(reg);

            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    // "installed" with an existing controller means this is a
                    // genuine update — the very first install has no
                    // controller yet, so it doesn't need the update prompt.
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        notifySiteUpdateAvailable(reg);
                    }
                });
            });
            if (typeof initPushNotifications === 'function') initPushNotifications();
        }).catch(e => console.error('SW registration failed:', e));

        // Re-check on return to the tab rather than only on page load, since
        // this is a single-page app a visitor may leave open for a long time.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && swRegistration) swRegistration.update();
        });

        let reloadedForUpdate = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloadedForUpdate) return;
            reloadedForUpdate = true;
            window.location.reload();
        });
    });
}

function notifySiteUpdateAvailable(registration) {
    const btn = document.getElementById('site-update-btn');
    if (btn) btn.style.display = '';
    // #site-update-toast (index.html) is its own element, deliberately not
    // routed through showShareToast()/#share-toast: that one is shared by
    // every "已加入最愛"-style fire-and-forget confirmation across the
    // site and always carries its own auto-hide timer, so reusing it here
    // would let an unrelated toast clobber the update notice, or have it
    // vanish on a timer before the visitor even notices it. This one only
    // goes away when applySiteUpdate() actually runs (see its onclick in
    // index.html) — the visitor decides when, not a timeout.
    const toast = document.getElementById('site-update-toast');
    if (toast && typeof t === 'function') {
        toast.textContent = t('site_update_available');
        toast.classList.add('show');
    }
}

function applySiteUpdate() {
    if (!swRegistration || !swRegistration.waiting) return;
    const btn = document.getElementById('site-update-btn');
    if (btn) btn.disabled = true;
    const toast = document.getElementById('site-update-toast');
    if (toast) { toast.classList.remove('show'); toast.onclick = null; }
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

let pwaDeferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pwaDeferredInstallPrompt = event;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    pwaDeferredInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
});

async function promptPwaInstall() {
    if (!pwaDeferredInstallPrompt) return;
    const btn = document.getElementById('pwa-install-btn');
    pwaDeferredInstallPrompt.prompt();
    await pwaDeferredInstallPrompt.userChoice;
    // Whatever the user picked, this specific prompt event is spent —
    // Chrome won't refire beforeinstallprompt until the next eligible visit.
    pwaDeferredInstallPrompt = null;
    if (btn) btn.style.display = 'none';
}

/* ===== Web Push (opt-in) =====
   A toggle in the notification dropdown. Server side:
   netlify/functions/push-subscribe.js (store), push-cron.js (30-min check
   of every subscriber's tracked players' PP), _push-store.js, push-config.js
   (serves the VAPID public key from env). Inert until the site owner sets
   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT — push-config then
   returns an empty key and the toggle stays hidden. */
let pushVapidKey = null;

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function initPushNotifications() {
    const row = document.getElementById('notif-push-row');
    if (!row || !pushSupported()) return;
    try {
        const cfg = await fetch('/.netlify/functions/push-config').then(r => r.json());
        pushVapidKey = cfg && cfg.vapidPublicKey;
    } catch { pushVapidKey = null; }
    // Only offer it to logged-in visitors — there's nothing to check pushes
    // against otherwise (tracked players hang off the osu! account).
    const loggedIn = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    if (!pushVapidKey || !loggedIn) { row.hidden = true; return; }
    row.hidden = false;
    await refreshPushToggleLabel();
}

async function currentPushSubscription() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
}

async function refreshPushToggleLabel() {
    const label = document.getElementById('notif-push-label');
    if (!label) return;
    const sub = await currentPushSubscription().catch(() => null);
    const on = !!sub && Notification.permission === 'granted';
    const key = on ? 'push_disable' : 'push_enable';
    label.setAttribute('data-i18n', key);   // so a later applyLang() keeps it right
    label.textContent = t(key);
    document.getElementById('notif-push-row')?.classList.toggle('on', on);
}

/* The players payload the server checks — kept in sync from here and from
   js/osu.js's track / untrack paths (they call syncPushPlayers). */
function pushPlayersPayload() {
    if (typeof getTrackedPlayers !== 'function') return [];
    return getTrackedPlayers().map(p => ({ id: String(p.id), username: p.username || null }));
}

async function togglePushNotifications() {
    if (!pushVapidKey) return;
    const existing = await currentPushSubscription().catch(() => null);
    if (existing && Notification.permission === 'granted') {
        try {
            await fetch('/.netlify/functions/push-subscribe', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: existing.endpoint }),
            });
        } catch { /* server prune will catch it eventually */ }
        try { await existing.unsubscribe(); } catch {}
        if (typeof showShareToast === 'function') showShareToast(t('push_off'));
        await refreshPushToggleLabel();
        return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
        if (typeof showShareToast === 'function') showShareToast(t('push_blocked'));
        return;
    }
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = existing || await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(pushVapidKey),
        });
        const user = getLoggedInOsuUser();
        const res = await fetch('/.netlify/functions/push-subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub, osuUserId: user && user.id, players: pushPlayersPayload() }),
        });
        if (!res.ok) throw new Error('subscribe failed');
        if (typeof showShareToast === 'function') showShareToast(t('push_on'));
    } catch (e) {
        console.error('push subscribe failed:', e);
        if (typeof showShareToast === 'function') showShareToast(t('push_fail'));
    }
    await refreshPushToggleLabel();
}

/* Called from js/osu.js after the tracked-players list changes, so the
   server's copy stays current without the visitor re-toggling. No-op if
   push isn't on. */
async function syncPushPlayers() {
    if (!pushSupported()) return;
    const sub = await currentPushSubscription().catch(() => null);
    if (!sub || Notification.permission !== 'granted') return;
    const user = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    if (!user) return;
    try {
        await fetch('/.netlify/functions/push-subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub, osuUserId: user.id, players: pushPlayersPayload() }),
        });
    } catch { /* next toggle / cron self-heals */ }
}
