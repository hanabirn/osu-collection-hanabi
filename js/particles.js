/* ===== Twinkling star-particle canvas =====
   Ported from the Bolt.new "osu! Player Tool" reference design
   (bolt.new/~/sb1-2gkeccgn, Version 6). Colors are read from this site's
   own --accent-pink/--accent-cyan CSS variables at runtime (re-read on
   theme toggle) rather than Bolt's hardcoded hex values, so dark/light
   mode both use their own accent hues.

   Battery/heat guard (2026-09): this canvas is the single biggest reason
   the page's compositor never idles — a full-viewport rAF loop that on
   phones kept the GPU hot enough to warm the device. So:
     - it does not run at all on touch/small screens or with
       prefers-reduced-motion (the CSS also display:none's the canvas there);
     - on desktop it is capped to ~30fps, drops the per-particle
       ctx.shadowBlur (a real gaussian blur every draw), and
     - pauses entirely while the tab is hidden. */
(function () {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;

    // Don't animate on phones/touch or when the visitor asked for less
    // motion — matches the css/particles.css `display:none` for the same
    // media so we never pay for a hidden canvas.
    if (window.matchMedia
        && (window.matchMedia('(prefers-reduced-motion: reduce)').matches
            || window.matchMedia('(hover: none), (max-width: 700px)').matches)) {
        return;
    }

    const ctx = canvas.getContext('2d');
    let particles = [];
    let W, H;
    let rafId = null;
    let lastTime = 0;
    const FRAME_MS = 33; // ~30fps cap

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    let COLORS;
    function refreshColors() {
        COLORS = [cssVar('--accent-cyan') || '#22d3ee', cssVar('--accent-pink') || '#f472b6'];
    }
    refreshColors();
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', () => setTimeout(refreshColors, 0));

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        const count = Math.min(90, Math.floor((W * H) / 18000));
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            r: Math.random() * 1.6 + 0.4,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            a: Math.random() * 0.5 + 0.2,
            pulse: Math.random() * Math.PI * 2,
            color: COLORS[Math.random() > 0.7 ? 1 : 0],
        }));
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.pulse += 0.03;
            if (p.x < 0) p.x = W;
            if (p.x > W) p.x = 0;
            if (p.y < 0) p.y = H;
            if (p.y > H) p.y = 0;
            const flicker = (Math.sin(p.pulse) + 1) / 2;
            const alpha = Math.floor(p.a * (0.4 + flicker * 0.6) * 255).toString(16).padStart(2, '0');
            // Cheap fake glow: a faint wide disc under the bright core,
            // instead of ctx.shadowBlur (a per-draw gaussian blur that was
            // most of this loop's GPU cost).
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
            ctx.fillStyle = p.color + '22';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color + alpha;
            ctx.fill();
        }
    }

    function tick(now) {
        rafId = requestAnimationFrame(tick);
        if (now - lastTime < FRAME_MS) return;
        lastTime = now;
        draw();
    }

    function start() {
        if (rafId == null) { lastTime = 0; rafId = requestAnimationFrame(tick); }
    }
    function stop() {
        if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // A background tab has no reason to keep painting stars.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop(); else start();
    });

    start();
})();
