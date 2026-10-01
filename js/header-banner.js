/* ===== 自訂頁首橫幅 — the visitor's own image behind the site header =====
   The image is shrunk to at most 2560×1440 JPEG in the browser and kept in
   IndexedDB (localStorage is already mostly the collection itself, and an
   image would blow its quota). Per device, not part of the JSON backup.
   It sits in .site-header-banner under a dark wash so the title stays
   readable; the vertical focus is a slider because a wide header crops
   most pictures. */
const HEADER_BANNER_DB = 'osu-header-banner';
const HEADER_BANNER_STORE = 'banner';
const HEADER_BANNER_POS_KEY = 'osu_header_banner_pos';
const HEADER_BANNER_MAX_BYTES = 15 * 1024 * 1024;
const HEADER_BANNER_MAX_W = 2560;
const HEADER_BANNER_MAX_H = 1440;
const HEADER_BANNER_DEFAULT_POS = 50;

let headerBannerUrl = null;
let headerBannerPos = HEADER_BANNER_DEFAULT_POS;
try {
    const raw = localStorage.getItem(HEADER_BANNER_POS_KEY);
    const saved = Number(raw);
    if (raw !== null && Number.isFinite(saved) && saved >= 0 && saved <= 100) headerBannerPos = saved;
} catch { /* storage blocked: default position */ }

function headerBannerDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(HEADER_BANNER_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(HEADER_BANNER_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function headerBannerIdb(mode, op) {
    const db = await headerBannerDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HEADER_BANNER_STORE, mode);
        const req = op(tx.objectStore(HEADER_BANNER_STORE));
        tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
}

/* Paints the current banner (or none) and shows the slider/reset only
   while one is set. */
function renderHeaderBanner() {
    const header = document.querySelector('.site-header');
    const layer = document.getElementById('site-header-banner');
    const pos = document.getElementById('header-banner-pos');
    const reset = document.getElementById('header-banner-reset');
    const has = !!headerBannerUrl;
    if (header) header.classList.toggle('has-banner', has);
    if (layer) {
        layer.style.backgroundImage = has ? `url("${headerBannerUrl}")` : '';
        layer.style.backgroundPosition = has ? `center ${headerBannerPos}%` : '';
    }
    if (pos) { pos.hidden = !has; pos.value = String(headerBannerPos); }
    if (reset) reset.hidden = !has;
}

function applyHeaderBanner(url) {
    if (headerBannerUrl) URL.revokeObjectURL(headerBannerUrl);
    headerBannerUrl = url;
    renderHeaderBanner();
}

async function shrinkHeaderBanner(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, HEADER_BANNER_MAX_W / bitmap.width, HEADER_BANNER_MAX_H / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.88);
    });
}

async function onHeaderBannerFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > HEADER_BANNER_MAX_BYTES) { showShareToast(t('hero_banner_too_big')); return; }
    if (!/^image\//.test(file.type)) { showShareToast(t('hero_banner_fail')); return; }
    try {
        const blob = await shrinkHeaderBanner(file);
        await headerBannerIdb('readwrite', s => s.put(blob, 'image'));
        setHeaderBannerPosition(HEADER_BANNER_DEFAULT_POS);
        applyHeaderBanner(URL.createObjectURL(blob));
        showShareToast(t('hero_banner_saved'));
    } catch (e) {
        console.error('Header banner save failed:', e);
        showShareToast(t('hero_banner_fail'));
    }
}

function setHeaderBannerPosition(value) {
    headerBannerPos = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    try { localStorage.setItem(HEADER_BANNER_POS_KEY, String(headerBannerPos)); } catch { /* per-device nicety */ }
    const layer = document.getElementById('site-header-banner');
    if (layer && headerBannerUrl) layer.style.backgroundPosition = `center ${headerBannerPos}%`;
}

async function resetHeaderBanner() {
    try { await headerBannerIdb('readwrite', s => s.delete('image')); } catch (e) { console.error('Header banner reset failed:', e); }
    try { localStorage.removeItem(HEADER_BANNER_POS_KEY); } catch { /* ignore */ }
    headerBannerPos = HEADER_BANNER_DEFAULT_POS;
    applyHeaderBanner(null);
    showShareToast(t('hero_banner_reset_done'));
}

(async function loadHeaderBanner() {
    try {
        const blob = await headerBannerIdb('readonly', s => s.get('image'));
        if (blob instanceof Blob) applyHeaderBanner(URL.createObjectURL(blob));
        else renderHeaderBanner();
    } catch (e) {
        console.warn('Header banner load failed:', e);
    }
})();
