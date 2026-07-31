/* ===== Twinkling star-particle canvas =====
   Ported from the Bolt.new "osu! Player Tool" reference design
   (bolt.new/~/sb1-2gkeccgn, Version 6). Colors are read from this site's
   own --accent-pink/--accent-cyan CSS variables at runtime (re-read on
   theme toggle) rather than Bolt's hardcoded hex values, so dark/light
   mode both use their own accent hues. */
(function () {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let W, H;

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
        const count = Math.floor((W * H) / 18000);
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

    function tick() {
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
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color + Math.floor(p.a * (0.4 + flicker * 0.6) * 255).toString(16).padStart(2, '0');
            ctx.shadowBlur = 6;
            ctx.shadowColor = p.color;
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        requestAnimationFrame(tick);
    }
    tick();
})();
