/* ===== 自訂橫幅 — the visitor's own image behind the collection hero =====
   The image is shrunk to at most 2560×1440 JPEG in the browser and kept in
   IndexedDB (localStorage is already mostly the collection itself, and an
   image would blow its quota). Per device, not part of the JSON backup.
   While one is set, updateCollectionHeroV2 (js/osu.js) shows it instead of
   rotating the collection's covers; the vertical focus is a slider because
   a wide banner crops most pictures. State lives on window.osuHeroBanner
   (not a top-level let) since osu.js, loaded earlier, reads it. */
const HERO_BANNER_DB = 'osu-hero-banner';
const HERO_BANNER_STORE = 'banner';
const HERO_BANNER_POS_KEY = 'osu_hero_banner_pos';
const HERO_BANNER_MAX_BYTES = 15 * 1024 * 1024;
const HERO_BANNER_MAX_W = 2560;
const HERO_BANNER_MAX_H = 1440;

window.osuHeroBanner = { url: null, pos: 30 };
try {
    const saved = Number(localStorage.getItem(HERO_BANNER_POS_KEY));
    if (Number.isFinite(saved) && saved >= 0 && saved <= 100 && localStorage.getItem(HERO_BANNER_POS_KEY) !== null) window.osuHeroBanner.pos = saved;
} catch { /* storage blocked: default position */ }

function heroBannerDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(HERO_BANNER_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(HERO_BANNER_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function heroBannerIdb(mode, op) {
    const db = await heroBannerDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HERO_BANNER_STORE, mode);
        const req = op(tx.objectStore(HERO_BANNER_STORE));
        tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
}

function applyHeroBanner(url) {
    if (window.osuHeroBanner.url) URL.revokeObjectURL(window.osuHeroBanner.url);
    window.osuHeroBanner.url = url;
    if (typeof updateCollectionHeroV2 === 'function') updateCollectionHeroV2();
}

/* Shows the position slider and reset button only while a banner is set. */
function syncHeroBannerTools() {
    const has = !!window.osuHeroBanner.url;
    const pos = document.getElementById('hero-banner-pos');
    const reset = document.getElementById('hero-banner-reset');
    if (pos) { pos.hidden = !has; pos.value = String(window.osuHeroBanner.pos); }
    if (reset) reset.hidden = !has;
}

async function shrinkHeroBanner(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, HERO_BANNER_MAX_W / bitmap.width, HERO_BANNER_MAX_H / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.88);
    });
}

async function onHeroBannerFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > HERO_BANNER_MAX_BYTES) { showShareToast(t('hero_banner_too_big')); return; }
    if (!/^image\//.test(file.type)) { showShareToast(t('hero_banner_fail')); return; }
    try {
        const blob = await shrinkHeroBanner(file);
        await heroBannerIdb('readwrite', s => s.put(blob, 'image'));
        setHeroBannerPosition(30);
        applyHeroBanner(URL.createObjectURL(blob));
        showShareToast(t('hero_banner_saved'));
    } catch (e) {
        console.error('Hero banner save failed:', e);
        showShareToast(t('hero_banner_fail'));
    }
}

function setHeroBannerPosition(value) {
    const pos = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    window.osuHeroBanner.pos = pos;
    try { localStorage.setItem(HERO_BANNER_POS_KEY, String(pos)); } catch { /* per-device nicety */ }
    const layer = document.querySelector('#collection-hero-v2 .hero-cover.active');
    if (layer && window.osuHeroBanner.url) layer.style.backgroundPosition = `center ${pos}%`;
}

async function resetHeroBanner() {
    try { await heroBannerIdb('readwrite', s => s.delete('image')); } catch (e) { console.error('Hero banner reset failed:', e); }
    try { localStorage.removeItem(HERO_BANNER_POS_KEY); } catch { /* ignore */ }
    window.osuHeroBanner.pos = 30;
    applyHeroBanner(null);
    showShareToast(t('hero_banner_reset_done'));
}

(async function loadHeroBanner() {
    try {
        const blob = await heroBannerIdb('readonly', s => s.get('image'));
        if (blob instanceof Blob) applyHeroBanner(URL.createObjectURL(blob));
        else syncHeroBannerTools();
    } catch (e) {
        console.warn('Hero banner load failed:', e);
    }
})();
