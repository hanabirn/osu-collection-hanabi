/* ===== Theme Toggle ===== */
function getTheme() {
    return localStorage.getItem('theme') || 'dark';
}

/* Builds #theme-toggle's sliding-switch content: a moon+twinkling-stars
   group and a sun+drifting-clouds group, both always present — which one
   shows and which side the thumb sits on is entirely CSS, keyed off the
   [data-theme] attribute this file already sets on <html> (see
   .theme-switch-track etc. in css/base.css). Built once (applyTheme below
   only calls this if the button is still empty) since there's nothing left
   to regenerate on a theme switch — no innerHTML replace, no animation
   restart bookkeeping. */
function themeSwitchHTML() {
    if (typeof icon !== 'function') return '';
    return `<span class="theme-switch-track" aria-hidden="true">
        <span class="theme-switch-icon-group theme-switch-moon-group">
            ${icon('moon', { size: '0.95em', filled: true })}
            <span class="theme-switch-star theme-switch-star-a">${icon('star', { size: '0.4em', filled: true })}</span>
            <span class="theme-switch-star theme-switch-star-b">${icon('star', { size: '0.3em', filled: true })}</span>
        </span>
        <span class="theme-switch-icon-group theme-switch-sun-group">
            ${icon('sun', { size: '1em', filled: true })}
            <span class="theme-switch-cloud theme-switch-cloud-a">${icon('cloud', { size: '0.55em', filled: true })}</span>
            <span class="theme-switch-cloud theme-switch-cloud-b">${icon('cloud', { size: '0.42em', filled: true })}</span>
        </span>
    </span>
    <span class="theme-switch-thumb"></span>`;
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn && !btn.querySelector('.theme-switch-track') && typeof icon === 'function') {
        btn.innerHTML = themeSwitchHTML();
    }
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = getTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* Apply theme immediately on load (before DOMContentLoaded to prevent flash) */
applyTheme(getTheme());
