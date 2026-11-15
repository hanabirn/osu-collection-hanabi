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
        if (t[key]) {
            el.title = t[key];
            // Keep an accessible name in sync when the element carries one.
            if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', t[key]);
        }
    });
    // An accessible name with no visible text of its own (sliders, icon controls).
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        if (t[key]) el.setAttribute('aria-label', t[key]);
    });
    // A <select> without a <label> is named by its first option ("全部語言",
    // "預設排序"), which says what it controls. Re-run here so the name
    // follows the language; only names this code set itself are replaced.
    document.querySelectorAll('select').forEach(sel => {
        if (sel.labels && sel.labels.length) return;
        if (sel.hasAttribute('aria-label') && !sel.hasAttribute('data-auto-aria')) return;
        const first = sel.options[0];
        if (!first) return;
        sel.setAttribute('aria-label', first.textContent.trim());
        sel.setAttribute('data-auto-aria', '');
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
    // split/join rather than replace(): a string pattern only replaces the
    // first match, and a placeholder may appear twice (batch_dl_confirm).
    return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), str);
}
