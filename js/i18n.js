/* ===== i18n =====
   Language dictionaries live in js/i18n/<lang>.js (one file per language).
   Each does `I18N.xx = {...}`, so those <script> tags must load AFTER
   this file declares I18N, and BEFORE any code below calls t()/applyLang(). ===== */
const I18N = {};

const SUPPORTED_LANGS = ['zh', 'zh-Hans', 'en', 'ja', 'ko', 'ru', 'fr', 'es', 'de'];

/* zh-CN / zh-SG / zh-Hans* -> Simplified; every other zh tag
   (zh-TW / zh-HK / zh-Hant / bare zh) -> Traditional (the `zh` file). */
function resolveZh(code) {
    return /^zh-(cn|sg|hans)/.test(code) ? 'zh-Hans' : 'zh';
}

function detectBrowserLang() {
    for (const tag of navigator.languages || [navigator.language]) {
        const code = tag.toLowerCase();
        if (code.startsWith('zh')) return resolveZh(code);
        const short = code.split('-')[0];
        if (SUPPORTED_LANGS.includes(short)) return short;
    }
    return 'zh';
}

let siteLang = window.__LANG || localStorage.getItem('site_lang') || detectBrowserLang();

/* Only the active locale ships in the initial HTML (see the bootstrap in
   index.html). Any other language the switcher picks is fetched on demand,
   once, then cached in I18N. */
const _localeLoads = {};
function loadLocale(lang) {
    if (I18N[lang]) return Promise.resolve();
    return _localeLoads[lang] || (_localeLoads[lang] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `js/i18n/${lang}.js`;
        s.async = false;
        s.onload = resolve;
        s.onerror = () => { delete _localeLoads[lang]; reject(new Error('locale load failed: ' + lang)); };
        document.head.appendChild(s);
    }));
}

function applyLang(lang) {
    siteLang = lang;
    try { localStorage.setItem('site_lang', lang); } catch (e) {}
    if (I18N[lang]) { applyLangDom(lang); return; }
    loadLocale(lang).then(() => applyLangDom(lang)).catch(() => applyLangDom('zh'));
}

/* Applied text pass — split out of applyLang() so the initial pre-paint
   bootstrap and the on-demand language switch share it. */
function applyLangDom(lang) {
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
    // Header button just shows the active language's flag chip (the full
    // name is too wide there) — mirror the matching pill's data-flag code.
    const currentPill = document.querySelector(`.lang-pill[data-lang="${lang}"]`);
    const currentLabel = document.getElementById('lang-globe-current');
    if (currentPill && currentLabel) {
        const code = currentPill.dataset.flag;
        currentLabel.innerHTML = /^[a-z]{2}$/.test(code || '') ? `<span class="flag flag--${code}"></span>` : (currentPill.textContent || '');
    }
    if (t.title) document.title = t.title;
    if (typeof refreshDynamicContent === 'function') refreshDynamicContent();
}

/* ===== i18n helpers for dynamic content =====
   Only the active locale (+ any the switcher lazy-loaded) is in I18N, so
   neither I18N[siteLang] nor I18N.zh is guaranteed present — fall back to
   the raw key rather than throwing. */
function t(key, params) {
    const dict = I18N[siteLang] || I18N.zh || {};
    const str = dict[key] || (I18N.zh || {})[key] || key;
    if (!params) return str;
    return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), str);
}
