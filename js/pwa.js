/* ===== PWA install + service worker registration =====
   The service worker (sw.js) makes the already-localStorage-backed
   collection page (js/osu.js) actually renderable offline by caching the
   app shell + beatmap cover/avatar images — see sw.js for why the osu! API
   itself stays out of that cache. This file just wires that up and exposes
   an "加到主畫面" button using the standard beforeinstallprompt flow. */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.error('SW registration failed:', e));
    });
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
