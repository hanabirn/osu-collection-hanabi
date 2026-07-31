/* ===== Theme Toggle ===== */
function getTheme() {
    return localStorage.getItem('theme') || 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = getTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* Apply theme immediately on load (before DOMContentLoaded to prevent flash) */
applyTheme(getTheme());
