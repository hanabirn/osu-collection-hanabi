/* ===== 🎨 Accent colour picker =====
   Replaced the old dark/light #theme-toggle switch 2026-09-13 — the site
   is dark-only now, and a visitor recolours it themselves instead (same
   idea as catch-tracker/js/settings-panel.js's ctApplyAccent(): color-mix()
   the chosen colour into the existing near-black surfaces so it retints the
   whole background wash, not just links/buttons). */
const ACCENT_KEY = 'osu_accent_color';
const ACCENT_SWATCHES = [
    '#f472b6', '#fb7185', '#fb923c', '#facc15', '#84cc16', '#34d399',
    '#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#e879f9', '#94a3b8',
];

// The literal hex/rgba values from css/theme.css's :root block — color-mix()
// blends the chosen accent into these, it never replaces them outright, so
// the shell stays dark regardless of how bright a colour is picked.
const ACCENT_BG_BASE = {
    '--bg': '#0b0b10',
    '--bg-body-1': '#0b0b10',
    '--bg-body-2': '#0b0b10',
    '--bg-body-3': '#0c0c12',
    '--bg-card': '#17141c',
    '--bg-input': '#1c1922',
    '--border': 'rgba(255,255,255,0.08)',
    '--border-card': 'rgba(255,255,255,0.11)',
};
// Full-strength accent tokens — set straight to the picked colour rather
// than color-mixed, same as ctApplyAccent()'s --accent/--primary.
const ACCENT_DIRECT_PROPS = ['--pink', '--pink-bright', '--text-pink', '--accent-pink', '--accent-purple'];

/* ===== Contrast guards =====
   The picker hands over an arbitrary hex, and two things break at the ends
   of that range. A near-black accent used as TEXT disappears into the dark
   shell; a white or near-white accent used as a BUTTON BACKGROUND swallows
   the white label sitting on it. Both are computed here rather than left to
   whoever picks the colour.

   Relative luminance and the 4.5:1 target are WCAG's (AA, normal text). */
const SHELL_BG = [11, 11, 16]; // --bg, the darkest surface text sits on

function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [244, 114, 182];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

function relLuminance([r, g, b]) {
    const lin = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
    const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/* Whichever of white / near-black reads better ON the accent. Used for the
   label of any control that paints itself with the accent. */
function onAccentColor(rgb) {
    return contrastRatio(rgb, [255, 255, 255]) >= contrastRatio(rgb, SHELL_BG) ? '#ffffff' : '#0b0b10';
}

/* The accent, lightened just enough to stay legible as text on the shell.
   Returns it untouched when it already clears the bar, so ordinary colours
   render exactly as picked and only the too-dark end is corrected. */
function readableOnShell(rgb, target = 4.5) {
    if (contrastRatio(rgb, SHELL_BG) >= target) return rgbToHex(rgb);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
        const t = (lo + hi) / 2;
        const mixed = rgb.map((c) => c + (255 - c) * t);
        if (contrastRatio(mixed, SHELL_BG) >= target) hi = t;
        else lo = t;
    }
    return rgbToHex(rgb.map((c) => c + (255 - c) * hi));
}

function hexToRgbString(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '244, 114, 182';
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function getAccentColor() {
    try { return localStorage.getItem(ACCENT_KEY); } catch { return null; }
}

function applyAccent(color) {
    const root = document.documentElement.style;
    if (!color) {
        Object.keys(ACCENT_BG_BASE).forEach(p => root.removeProperty(p));
        ACCENT_DIRECT_PROPS.forEach(p => root.removeProperty(p));
        root.removeProperty('--accent-light-purple');
        root.removeProperty('--pink-rgb');
        root.removeProperty('--accent-pink-rgb');
        root.removeProperty('--accent-purple-rgb');
        root.removeProperty('--on-accent');
        return;
    }
    const rgb = hexToRgbString(color);
    const parts = hexToRgb(color);
    ACCENT_DIRECT_PROPS.forEach(p => root.setProperty(p, color));
    /* Text keeps a floor on contrast against the shell; the raw colour
       stays on --pink etc. so fills and borders are exactly what was
       picked. --on-accent is what any accent-painted control labels
       itself with. */
    root.setProperty('--text-pink', readableOnShell(parts));
    root.setProperty('--on-accent', onAccentColor(parts));
    root.setProperty('--accent-light-purple', `color-mix(in srgb, ${color} 65%, white)`);
    root.setProperty('--pink-rgb', rgb);
    root.setProperty('--accent-pink-rgb', rgb);
    root.setProperty('--accent-purple-rgb', rgb);
    Object.entries(ACCENT_BG_BASE).forEach(([prop, base]) => {
        root.setProperty(prop, `color-mix(in srgb, ${color} 12%, ${base})`);
    });
}
applyAccent(getAccentColor()); // run immediately (deferred script, but still pre-paint) to minimise flash-of-default-colour

function setAccentColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    try { localStorage.setItem(ACCENT_KEY, color); } catch { /* per-browser convenience only */ }
    applyAccent(color);
    renderAccentPickerState();
}
function resetAccentColor() {
    try { localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
    applyAccent(null);
    renderAccentPickerState();
}
function renderAccentPickerState() {
    const current = getAccentColor();
    document.querySelectorAll('.accent-swatch').forEach(s => s.classList.toggle('active', s.getAttribute('data-color') === current));
    const customInput = document.getElementById('accent-picker-custom');
    if (customInput && /^#[0-9a-f]{6}$/i.test(current || '')) customInput.value = current;
}

/* ===== Accent picker dropdown ===== (same open/outside-click/Escape
   pattern as the language/contact dropdowns in js/main.js) */
function toggleAccentPicker(forceOpen) {
    const wrap = document.getElementById('accent-picker');
    const btn = document.getElementById('accent-picker-btn');
    const header = document.querySelector('.site-header');
    if (!wrap || !btn) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (header) header.classList.toggle('accent-picker-open', open);
    if (open) {
        renderAccentPickerState();
        document.addEventListener('click', onAccentPickerOutsideClick);
        document.addEventListener('keydown', onAccentPickerEscape);
    } else {
        document.removeEventListener('click', onAccentPickerOutsideClick);
        document.removeEventListener('keydown', onAccentPickerEscape);
    }
}
function onAccentPickerOutsideClick(e) {
    if (!e.target.closest('#accent-picker')) toggleAccentPicker(false);
}
function onAccentPickerEscape(e) {
    if (e.key === 'Escape') toggleAccentPicker(false);
}
