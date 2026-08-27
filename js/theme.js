/* ===== Theme Toggle ===== */
function getTheme() {
    return localStorage.getItem('theme') || 'dark';
}

/* Decorative flourish for #theme-toggle, layered next to the static sun/
   moon icon that shows which theme clicking the button would switch TO
   (see applyTheme below). This instead depicts the theme that was just
   entered — a sun+clouds pop-in when switching to light, a moon+stars
   twinkle when switching to dark — so it reads as a brief "you're now in
   ___ mode" confirmation rather than duplicating the static click target.
   Built fresh every applyTheme() call (innerHTML replaced wholesale), so
   the CSS keyframes just play once on insertion — no animationend/replay
   bookkeeping needed. */
function themeToggleDecoHTML(theme) {
    if (typeof icon !== 'function') return '';
    if (theme === 'light') {
        return `<span class="tt-deco tt-deco-sun" aria-hidden="true">${icon('sun', { size: '0.62em' })}</span>
            <span class="tt-deco tt-deco-cloud tt-deco-cloud-a" aria-hidden="true">${icon('cloud', { size: '0.5em', filled: true })}</span>
            <span class="tt-deco tt-deco-cloud tt-deco-cloud-b" aria-hidden="true">${icon('cloud', { size: '0.4em', filled: true })}</span>`;
    }
    return `<span class="tt-deco tt-deco-moon" aria-hidden="true">${icon('moon', { size: '0.6em', filled: true })}</span>
        <span class="tt-deco tt-deco-star tt-deco-star-a" aria-hidden="true">${icon('star', { size: '0.32em', filled: true })}</span>
        <span class="tt-deco tt-deco-star tt-deco-star-b" aria-hidden="true">${icon('star', { size: '0.26em', filled: true })}</span>
        <span class="tt-deco tt-deco-star tt-deco-star-c" aria-hidden="true">${icon('star', { size: '0.22em', filled: true })}</span>`;
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    // Icon reflects the theme you'd switch TO, same as the old emoji did —
    // set directly via icon() rather than the data-icon/renderStaticIcons
    // path, since this one swaps on every toggle, not just once on load.
    if (btn && typeof icon === 'function') btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon') + themeToggleDecoHTML(theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = getTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* Apply theme immediately on load (before DOMContentLoaded to prevent flash) */
applyTheme(getTheme());
