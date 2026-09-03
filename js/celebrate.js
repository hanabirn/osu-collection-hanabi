/* ===== Celebration fireworks burst =====
   Fired from js/notifications.js's addNotification() when a tracked player
   gains PP or unlocks a new achievement — the site is named "花火"
   (fireworks), so this is the one place that name becomes literal. Uses
   canvas-confetti (CDN, see index.html) rather than a full particle-system
   library since this is only an occasional one-off burst, not a persistent
   background layer like js/particles.js. */
async function celebrateBurst() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof confetti !== 'function') {
        try { await ensureConfetti(); } catch (e) { return; }
    }
    if (typeof confetti !== 'function') return;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    const colors = [
        cssVar('--accent-pink'), cssVar('--accent-purple'),
        cssVar('--accent-cyan'), cssVar('--accent-yellow'),
    ].filter(Boolean);

    const shoot = (originX, delay) => setTimeout(() => confetti({
        particleCount: 60,
        spread: 70,
        startVelocity: 45,
        gravity: 0.9,
        ticks: 200,
        origin: { x: originX, y: 0.55 + Math.random() * 0.1 },
        colors,
        zIndex: 9999,
    }), delay);

    shoot(0.3, 0);
    shoot(0.7, 200);
    shoot(0.5, 400);
}
