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
