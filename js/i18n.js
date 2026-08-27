/* ===== i18n =====
   Language dictionaries live in js/i18n/<lang>.js (one file per language).
   Each does `I18N.xx = {...}`, so those <script> tags must load AFTER
   this file declares I18N, and BEFORE any code below calls t()/applyLang(). ===== */
const I18N = {};

const SUPPORTED_LANGS = ['zh', 'en', 'ja', 'ko', 'ru', 'fr', 'es', 'de'];

function detectBrowserLang() {
    for (const tag of navigator.languages || [navigator.language]) {
        const code = tag.toLowerCase();
        if (code.startsWith('zh')) return 'zh';
        const short = code.split('-')[0];
        if (SUPPORTED_LANGS.includes(short)) return short;
    }
    return 'zh';
}

let siteLang = localStorage.getItem('site_lang') || detectBrowserLang();

function applyLang(lang) {
    siteLang = lang;
    localStorage.setItem('site_lang', lang);
    document.documentElement.lang = lang;
    const t = I18N[lang] || I18N.zh;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.innerHTML = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.placeholder = t[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (t[key]) el.title = t[key];
    });
    document.querySelectorAll('.lang-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
    // Each language names itself (not translated content), so this just
    // copies whichever .lang-pill already carries that name rather than
    // duplicating the eight labels into a separate lookup table.
    const currentPill = document.querySelector(`.lang-pill[data-lang="${lang}"]`);
    const currentLabel = document.getElementById('lang-globe-current');
    if (currentPill && currentLabel) currentLabel.textContent = currentPill.textContent;
    if (t.title) document.title = t.title;
    if (typeof refreshDynamicContent === 'function') refreshDynamicContent();
}

/* ===== i18n helpers for dynamic content ===== */
function t(key, params) {
    const str = (I18N[siteLang] || I18N.zh)[key] || (I18N.zh)[key] || key;
    if (!params) return str;
    return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), str);
}
