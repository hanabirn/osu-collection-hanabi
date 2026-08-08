/* ===== Theme Toggle ===== */
function getTheme() {
    return localStorage.getItem('theme') || 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    // Icon reflects the theme you'd switch TO, same as the old emoji did —
    // set directly via icon() rather than the data-icon/renderStaticIcons
    // path, since this one swaps on every toggle, not just once on load.
    if (btn && typeof icon === 'function') btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = getTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* Apply theme immediately on load (before DOMContentLoaded to prevent flash) */
applyTheme(getTheme());
