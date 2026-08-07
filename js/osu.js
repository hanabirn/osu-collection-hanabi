/* ===== Small helpers ported from the main site's js/quiz.js (osu.js's only
   two external dependencies there) — inlined here since this site doesn't
   load quiz.js. ===== */
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showShareToast(msg) {
    let toast = document.getElementById('share-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'share-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'share-toast show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.className = 'share-toast'; }, 2500);
}

/* ===== osu! Collection ===== */
const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const OSU_MODE_NAMES = { 0: 'standard', 1: 'taiko', 2: 'catch', 3: 'mania' };
const OSU_MODE_LABELS = ['Standard', 'Taiko', 'Catch', 'Mania'];

const MODE_ICON_PATHS = {
    standard: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="50" r="22" fill="currentColor" stroke="none"/>',
    taiko: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="50" r="29"/><line x1="50" y1="21" x2="50" y2="79"/>',
    catch: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="38" r="7" fill="currentColor" stroke="none"/><circle cx="38" cy="60" r="5.5" fill="currentColor" stroke="none"/><circle cx="62" cy="60" r="5.5" fill="currentColor" stroke="none"/>',
    mania: '<circle cx="50" cy="50" r="41"/><rect x="31" y="39" width="8" height="22" rx="4" fill="currentColor" stroke="none"/><rect x="42" y="31" width="8" height="38" rx="4" fill="currentColor" stroke="none"/><rect x="53" y="31" width="8" height="38" rx="4" fill="currentColor" stroke="none"/><rect x="64" y="39" width="8" height="22" rx="4" fill="currentColor" stroke="none"/>'
};
function modeIconSvg(mode) {
    const path = MODE_ICON_PATHS[mode];
    if (!path) return '';
    return `<svg class="mode-icon-inline" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6">${path}</svg>`;
}
let osuCurrentTab = 'standard';
let osuCurrentAudio = null;
let osuVolume = 0.4;
let osuPage = 0;
let osuSortMode = 'default';
let osuSearchQuery = '';
const OSU_PAGE_SIZE = 8;

function osuAvatarUrl(userId) {
    return `/.netlify/functions/osu-avatar?id=${userId}`;
}

function filterOsuCollection(query) {
    osuSearchQuery = query.trim();
    osuPage = 0;
    renderOsuCollection();
}

function switchOsuSort(mode) {
    osuSortMode = mode;
    osuPage = 0;
    renderOsuCollection();
}

function osuSetMaxRating(set) {
    return Math.max(...set.beatmaps.map(b => b.difficulty_rating));
}

function sortOsuSets(sets) {
    if (osuSortMode === 'rating-desc') return [...sets].sort((a, b) => osuSetMaxRating(b) - osuSetMaxRating(a));
    if (osuSortMode === 'rating-asc') return [...sets].sort((a, b) => osuSetMaxRating(a) - osuSetMaxRating(b));
    return sets;
}

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getOsuPassword() { return localStorage.getItem('osu_password_hash'); }

async function setOsuPassword(pw) {
    localStorage.setItem('osu_password_hash', await sha256(pw));
}

function hasOsuPassword() { return !!getOsuPassword(); }

let osuPasswordVerifiedThisSession = false;

async function verifyOsuPassword() {
    if (!hasOsuPassword() || osuPasswordVerifiedThisSession) return true;
    const pw = prompt(t('osu_password_prompt'));
    if (pw === null) return false;
    const hash = await sha256(pw);
    if (hash !== getOsuPassword()) {
        alert(t('osu_password_wrong'));
        return false;
    }
    osuPasswordVerifiedThisSession = true;
    return true;
}

async function setupOsuPassword() {
    if (!await verifyOsuPassword()) return;
    const pw = prompt(t('osu_set_password'));
    if (pw === null || pw === '') return;
    const pw2 = prompt(t('osu_confirm_password'));
    if (pw !== pw2) { alert(t('osu_password_mismatch')); return; }
    await setOsuPassword(pw);
    osuPasswordVerifiedThisSession = true;
    alert(t('osu_password_set'));
}

function copyBeatmapId(setId, event) {
    event.stopPropagation();
    navigator.clipboard.writeText(String(setId)).then(() => {
        const btn = event.currentTarget;
        btn.classList.add('copied');
        btn.innerText = '✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerText = '📋'; }, 1200);
    });
}

/* Direct beatmapset download via hinai (mirror.hinamizawa.ai), an open-source
   no-login mirror — osu.ppy.sh's own download requires an account/supporter.
   no_video keeps the .osz small; ?redirect=true has it 307 to the fastest
   working mirror host so the browser just follows it and saves the file. */
function downloadBeatmapset(setId, event) {
    event.stopPropagation();
    window.open(`https://mirror.hinamizawa.ai/d/${setId}?no_video=true&redirect=true`, '_blank');
}

function osuSetVolume(val) {
    osuVolume = parseFloat(val);
    if (osuCurrentAudio && !osuCurrentAudio.ended) osuCurrentAudio.volume = osuVolume;
}

function playOsuPreview(setId, event) {
    event.stopPropagation();
    const previewUrl = `https://b.ppy.sh/preview/${setId}.mp3`;

    if (osuCurrentAudio && !osuCurrentAudio.ended) {
        osuCurrentAudio.pause();
        document.querySelectorAll('.osu-play-btn').forEach(b => b.classList.remove('playing'));
        if (osuCurrentAudio._setId === setId) { osuCurrentAudio = null; return; }
    }

    const audio = new Audio(previewUrl);
    audio._setId = setId;
    audio.volume = osuVolume;
    osuCurrentAudio = audio;

    const btn = event.currentTarget;
    btn.classList.add('playing');
    audio.play().catch(() => {});
    audio.onended = () => {
        btn.classList.remove('playing');
        osuCurrentAudio = null;
    };
    audio.onerror = () => {
        btn.classList.remove('playing');
        osuCurrentAudio = null;
    };
}

function getOsuFavorites() {
    try { return JSON.parse(localStorage.getItem('osu_favorites')) || []; }
    catch { return []; }
}

function saveOsuFavorites(favs) {
    localStorage.setItem('osu_favorites', JSON.stringify(favs));
}

function isOsuFavorited(setId) {
    return getOsuFavorites().includes(setId);
}

async function toggleOsuFavorite(setId, event) {
    event.stopPropagation();
    if (!await verifyOsuPassword()) return;
    const favs = getOsuFavorites();
    const idx = favs.indexOf(setId);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(setId);
    saveOsuFavorites(favs);
    renderOsuCollection();
}

/* ===== Custom collection categories =====
   Generalizes the single "Favorites" tag into user-defined named tags,
   many-to-many with beatmaps. Local-only — deliberately not included in
   shareOsuCollectionLink()/checkImportFromHash() or the public gallery
   publish, same reach as favorites today. */
/* Locale-aware sort so categories display in a sensible order regardless
   of what script their names happen to be in: 'ja' collation gives real
   alphabetical order for Latin names, gojuon (あいうえお) order for kana,
   and falls back to code-point order for kanji/hanzi (no single "correct"
   order exists there without per-character reading data, so this is
   intentionally just "consistent", not linguistically meaningful). */
function sortCategoriesByName(cats) {
    return [...cats].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function getOsuCategories() {
    try { return sortCategoriesByName(JSON.parse(localStorage.getItem('osu_categories')) || []); }
    catch { return []; }
}

function saveOsuCategories(cats) {
    localStorage.setItem('osu_categories', JSON.stringify(cats));
}

function getOsuCategoryMembers() {
    try { return JSON.parse(localStorage.getItem('osu_category_members')) || {}; }
    catch { return {}; }
}

function saveOsuCategoryMembers(members) {
    localStorage.setItem('osu_category_members', JSON.stringify(members));
}

function getCategoryMemberIds(categoryId) {
    return getOsuCategoryMembers()[categoryId] || [];
}

/* Refreshes the modal's list too when the mutating action was triggered
   from inside it (openCategoryManageModal), so rename/delete stay in sync
   with the modal view without every caller needing to remember to do it. */
function refreshCategoryManageModalIfOpen() {
    const modal = document.getElementById('category-manage-modal');
    if (modal && modal.style.display !== 'none') renderCategoryManageList();
}

async function renameOsuCategory(categoryId, event) {
    if (event) event.stopPropagation();
    if (!await verifyOsuPassword()) return;
    const cats = getOsuCategories();
    const cat = cats.find(c => c.id === categoryId);
    if (!cat) return;
    const name = prompt(t('osu_category_rename_prompt'), cat.name);
    if (!name || !name.trim()) return;
    cat.name = name.trim();
    saveOsuCategories(cats);
    refreshCategoryManageModalIfOpen();
    renderOsuCollection();
}

async function deleteOsuCategory(categoryId, event) {
    if (event) event.stopPropagation();
    if (!await verifyOsuPassword()) return;
    if (!confirm(t('osu_category_delete_confirm'))) return;
    saveOsuCategories(getOsuCategories().filter(c => c.id !== categoryId));
    const members = getOsuCategoryMembers();
    delete members[categoryId];
    saveOsuCategoryMembers(members);
    if (osuCurrentTab === categoryId) osuCurrentTab = 'standard';
    refreshCategoryManageModalIfOpen();
    renderOsuCollection();
}

/* ===== Category tabs row (between the mode-tabs row and the search bar) =====
   A second .osu-mode-tabs-style row, one plain clickable .osu-tab per
   category — clicking reuses switchOsuTab() directly (it doesn't care
   whether "mode" is a real mode key or a category id, it just toggles
   .active and re-renders). Doesn't wrap; overflow scrolls horizontally,
   including via a plain vertical mouse wheel (initCategoryTabsWheelScroll)
   since most mice don't have a horizontal scroll axis. Add/rename/delete
   live in the ⚙ manage modal (openCategoryManageModal below), not here —
   this row is pure navigation. */
function renderOsuCategoryTabsRow() {
    const row = document.getElementById('osu-category-tabs-row');
    if (!row) return;
    const cats = getOsuCategories();
    row.innerHTML = cats.map(c =>
        `<button class="osu-tab ${c.id === osuCurrentTab ? 'active' : ''}" data-mode="${c.id}" onclick="switchOsuTab('${c.id}', this)">🏷 ${escHtml(c.name)}</button>`
    ).join('');
    initCategoryTabsWheelScroll();
}

function initCategoryTabsWheelScroll() {
    const row = document.getElementById('osu-category-tabs-row');
    if (!row || row.dataset.wheelBound) return;
    row.dataset.wheelBound = '1';
    row.addEventListener('wheel', e => {
        if (e.deltaY === 0) return;
        e.preventDefault();
        row.scrollLeft += e.deltaY;
    }, { passive: false });
}

/* ===== Category manage modal (⚙ button next to the select dropdown) =====
   Add/rename/delete all live here — reuses the .pp-calc-modal-* shell
   (see gallery-detail-modal for the other user of that pattern). */
function openCategoryManageModal() {
    const modal = document.getElementById('category-manage-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderCategoryManageList();
}

function closeCategoryManageModal() {
    const modal = document.getElementById('category-manage-modal');
    if (modal) modal.style.display = 'none';
}

function renderCategoryManageList() {
    const listEl = document.getElementById('osu-category-manage-list');
    if (!listEl) return;
    const cats = getOsuCategories();
    listEl.innerHTML = cats.length === 0
        ? `<p class="osu-empty">${t('osu_category_picker_empty')}</p>`
        : cats.map(c => `
            <div class="osu-category-manage-item">
                <span class="osu-category-manage-name">${escHtml(c.name)}</span>
                <span class="osu-category-manage-actions">
                    <button class="osu-cat-rename" onclick="renameOsuCategory('${c.id}', event)" title="${t('osu_category_rename_title')}">✎</button>
                    <button class="osu-cat-delete" onclick="deleteOsuCategory('${c.id}', event)" title="${t('osu_category_delete_title')}">🗑</button>
                </span>
            </div>`).join('');
}

async function addOsuCategoryFromModal() {
    if (!await verifyOsuPassword()) return;
    const input = document.getElementById('osu-category-manage-input');
    const name = input.value.trim();
    if (!name) return;
    const cats = getOsuCategories();
    cats.push({ id: crypto.randomUUID(), name });
    saveOsuCategories(cats);
    input.value = '';
    renderCategoryManageList();
    renderOsuCollection();
}

/* ===== Per-card category assignment popover =====
   A single document.body-level singleton (same lazy-singleton pattern as
   #share-toast, see showShareToast() above) rather than a per-card popover,
   because .osu-card has overflow:hidden (load-bearing for the cover-image
   hover-zoom) which would clip anything absolutely-positioned inside it,
   and renderOsuCollection() replaces #osu-collection's innerHTML on every
   re-render (including the one triggered by ticking a checkbox), which
   would destroy a popover embedded in a card mid-interaction. */
function ensureCategoryPickerEl() {
    let el = document.getElementById('osu-category-picker');
    if (!el) {
        el = document.createElement('div');
        el.id = 'osu-category-picker';
        el.className = 'osu-category-picker';
        document.body.appendChild(el);
    }
    return el;
}

let osuCategoryPickerSetId = null;

function toggleCategoryPicker(setId, event) {
    event.stopPropagation();
    const el = ensureCategoryPickerEl();
    if (osuCategoryPickerSetId === setId && el.classList.contains('open')) {
        closeCategoryPicker();
        return;
    }
    osuCategoryPickerSetId = setId;
    renderCategoryPickerContent(setId);
    // .osu-category-picker is position:fixed, so getBoundingClientRect()'s
    // viewport-relative coordinates are exactly what's needed here — adding
    // window.scrollY/scrollX (which is correct for position:absolute) double-
    // counts the scroll offset and drifts the popover away from the button
    // the further down the page you've scrolled.
    const r = event.currentTarget.getBoundingClientRect();
    el.style.top = `${r.bottom + 6}px`;
    el.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`;
    el.classList.add('open');
    document.addEventListener('click', onCategoryPickerOutsideClick);
    document.addEventListener('keydown', onCategoryPickerEscape);
}

function closeCategoryPicker() {
    const el = document.getElementById('osu-category-picker');
    if (el) el.classList.remove('open');
    osuCategoryPickerSetId = null;
    document.removeEventListener('click', onCategoryPickerOutsideClick);
    document.removeEventListener('keydown', onCategoryPickerEscape);
}

function onCategoryPickerOutsideClick(e) {
    if (!e.target.closest('#osu-category-picker') && !e.target.closest('.osu-category-btn')) closeCategoryPicker();
}

function onCategoryPickerEscape(e) {
    if (e.key === 'Escape') closeCategoryPicker();
}

function renderCategoryPickerContent(setId) {
    const el = document.getElementById('osu-category-picker');
    const cats = getOsuCategories();
    if (cats.length === 0) {
        el.innerHTML = `<div class="osu-category-picker-empty">${t('osu_category_picker_empty')}</div>`;
        return;
    }
    const members = getOsuCategoryMembers();
    el.innerHTML = `<div class="osu-category-picker-title">${t('osu_category_picker_title')}</div>` +
        cats.map(c => `
        <label class="osu-category-picker-item">
            <input type="checkbox" ${(members[c.id] || []).includes(setId) ? 'checked' : ''} onchange="toggleCategoryMembership('${c.id}', ${setId})">
            <span>${escHtml(c.name)}</span>
        </label>`).join('');
}

async function toggleCategoryMembership(categoryId, setId) {
    if (!await verifyOsuPassword()) { renderCategoryPickerContent(setId); return; }
    const members = getOsuCategoryMembers();
    const arr = members[categoryId] || (members[categoryId] = []);
    const idx = arr.indexOf(setId);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(setId);
    saveOsuCategoryMembers(members);
    renderCategoryPickerContent(setId);
    renderOsuCollection();
}

function getOsuCollection() {
    try {
        return JSON.parse(localStorage.getItem('osu_collection')) || { standard: [], taiko: [], catch: [], mania: [] };
    } catch { return { standard: [], taiko: [], catch: [], mania: [] }; }
}

function saveOsuCollection(col) {
    localStorage.setItem('osu_collection', JSON.stringify(col));
}

/* ===== Background carousel from the visitor's own collected beatmap covers =====
   osu! has no character roster to draw on (unlike the pjsekai/wuwa sibling
   sites), so this fades between covers of whatever is actually in the
   visitor's collection instead — personalized, no art curation needed. */
function initOsuBgCarousel() {
    const col = getOsuCollection();
    const ids = [...new Set(OSU_MODES.flatMap(mode => col[mode].map(s => s.beatmapset_id)))];
    if (ids.length === 0) return;
    const shuffled = ids.slice().sort(() => Math.random() - 0.5);
    // cover.jpg is only 900x250 — visibly blurry stretched across a full-page
    // background. cover@2x.jpg is the same crop at double resolution.
    const urls = shuffled.map(id => `https://assets.ppy.sh/beatmaps/${id}/covers/cover@2x.jpg`);
    renderOsuBgCarousel(urls);
}

function renderOsuBgCarousel(urls) {
    const container = document.getElementById('bg-carousel');
    if (!container || !urls.length) return;
    container.innerHTML = urls.map(u => `<div class="bg-slide" style="background-image:url('${u}')"></div>`).join('');
    runOsuBgSlideCarousel(7000);
}

function runOsuBgSlideCarousel(intervalMs) {
    const slides = document.querySelectorAll('#bg-carousel .bg-slide');
    if (!slides.length) return;
    let idx = 0;
    slides[0].classList.add('active');
    setInterval(() => {
        slides[idx].classList.remove('active');
        idx = (idx + 1) % slides.length;
        slides[idx].classList.add('active');
    }, intervalMs);
}

function exportOsuCollection() {
    const data = {
        collection: getOsuCollection(),
        favorites: getOsuFavorites(),
        categories: getOsuCategories(),
        categoryMembers: getOsuCategoryMembers(),
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `osu-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showShareToast(t('osu_export_done'));
}

async function importOsuCollection(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!await verifyOsuPassword()) { event.target.value = ''; return; }
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.collection || !OSU_MODES.every(m => Array.isArray(data.collection[m]))) {
            throw new Error('invalid format');
        }
        saveOsuCollection(data.collection);
        if (Array.isArray(data.favorites)) saveOsuFavorites(data.favorites);
        if (Array.isArray(data.categories)) saveOsuCategories(data.categories);
        if (data.categoryMembers && typeof data.categoryMembers === 'object' && !Array.isArray(data.categoryMembers)) {
            saveOsuCategoryMembers(data.categoryMembers);
        }
        renderOsuCollection();
        showShareToast(t('osu_import_done'));
    } catch (e) {
        console.error('Import failed:', e);
        alert(t('osu_import_fail'));
    } finally {
        event.target.value = '';
    }
}

/* ===== Shareable collection link =====
   Encodes the collection as gzip+base64url into a URL hash fragment (never
   sent to any server, so there's no size limit imposed by a backend) —
   anyone who opens the link gets prompted to merge those beatmaps into
   their own collection, skipping ones they already have. */
function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function compressToBase64Url(obj) {
    const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return base64UrlEncode(new Uint8Array(buf));
}

async function decompressFromBase64Url(encoded) {
    const stream = new Blob([base64UrlDecode(encoded)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
}

async function shareOsuCollectionLink() {
    const col = getOsuCollection();
    const totalSets = OSU_MODES.reduce((sum, m) => sum + col[m].length, 0);
    if (totalSets === 0) {
        showShareToast(t('osu_share_link_empty'));
        return;
    }
    try {
        const encoded = await compressToBase64Url({ collection: col });
        const url = `${location.origin}${location.pathname}#import=${encoded}`;
        await navigator.clipboard.writeText(url);
        showShareToast(t('osu_share_link_done'));
    } catch (e) {
        console.error('Share link generation failed:', e);
        showShareToast(t('osu_share_link_fail'));
    }
}

/* Merges an incoming collection (from a share link or, later, a public
   gallery download) into the visitor's own — never overwrites, only adds
   beatmapsets they don't already have. Returns how many were added. */
function mergeIncomingCollection(incoming) {
    const col = getOsuCollection();
    let added = 0;
    for (const mode of OSU_MODES) {
        const existingIds = new Set(col[mode].map(s => s.beatmapset_id));
        for (const set of (incoming[mode] || [])) {
            if (!existingIds.has(set.beatmapset_id)) {
                col[mode].push(set);
                existingIds.add(set.beatmapset_id);
                added++;
            }
        }
    }
    saveOsuCollection(col);
    return added;
}

async function checkImportFromHash() {
    const hash = location.hash;
    if (!hash.startsWith('#import=')) return;
    const encoded = hash.slice('#import='.length);
    history.replaceState(null, '', location.pathname + location.search);

    try {
        const data = await decompressFromBase64Url(encoded);
        if (!data.collection || !OSU_MODES.every(m => Array.isArray(data.collection[m]))) throw new Error('invalid format');

        const incomingCount = OSU_MODES.reduce((sum, m) => sum + data.collection[m].length, 0);
        if (!confirm(t('osu_share_link_import_confirm', { n: incomingCount }))) return;

        const added = mergeIncomingCollection(data.collection);
        renderOsuCollection();
        showShareToast(t('osu_share_link_imported', { n: added }));
    } catch (e) {
        console.error('Import from link failed:', e);
        showShareToast(t('osu_share_link_import_fail'));
    }
}

function parseOsuInput(input) {
    const urlMatch = input.match(/osu\.ppy\.sh\/(?:beatmaps?|beatmapsets?)\/(\d+)/);
    if (urlMatch) return { type: 'url', id: urlMatch[1], isSet: input.includes('beatmapsets') };
    if (/^\d+$/.test(input.trim())) return { type: 'id', id: input.trim(), isSet: false };
    return null;
}

async function osuFetch(params, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(`/.netlify/functions/osu?${params}`, { signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`請求逾時（${timeoutMs / 1000}秒）`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error(`Function 回傳非 JSON (HTTP ${res.status}): ${text.substring(0, 200)}`); }
}

async function addOsuBeatmap() {
    if (!await verifyOsuPassword()) return;
    const input = document.getElementById('osuInput');
    const status = document.getElementById('osu-status');
    const raw = input.value.trim();
    if (!raw) return;

    const parsed = parseOsuInput(raw);
    if (!parsed) {
        status.innerText = t('osu_input_error');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('osu_searching');
    status.style.color = '#c8a2e0';

    try {
        let beatmaps = [];

        if (parsed.isSet || parsed.type === 'url' && input.value.includes('beatmapsets')) {
            beatmaps = await osuFetch(`s=${parsed.id}`);
        }

        if (beatmaps.length === 0) {
            const byMap = await osuFetch(`b=${parsed.id}`);
            if (byMap.length > 0) {
                beatmaps = await osuFetch(`s=${byMap[0].beatmapset_id}`);
            }
        }

        if (beatmaps.length === 0 && !parsed.isSet) {
            beatmaps = await osuFetch(`s=${parsed.id}`);
        }

        if (beatmaps.length === 0) {
            status.innerText = t('osu_not_found');
            status.style.color = '#ff5252';
            return;
        }

        const modeNum = parseInt(beatmaps[0].mode);
        const modeKey = OSU_MODE_NAMES[modeNum];
        const col = getOsuCollection();

        const alreadyExists = col[modeKey].some(s => s.beatmapset_id === parseInt(beatmaps[0].beatmapset_id));
        if (alreadyExists) {
            status.innerText = t('osu_already_exists', { n: `${beatmaps[0].artist} - ${beatmaps[0].title}` });
            status.style.color = '#f59e0b';
            return;
        }

        const setInfo = {
            beatmapset_id: parseInt(beatmaps[0].beatmapset_id),
            title: beatmaps[0].title,
            artist: beatmaps[0].artist,
            creator: beatmaps[0].creator,
            mode: modeNum,
            beatmaps: beatmaps.map(b => ({
                beatmap_id: parseInt(b.beatmap_id),
                version: b.version,
                difficulty_rating: parseFloat(b.difficultyrating),
                hit_length: parseInt(b.hit_length),
                total_length: parseInt(b.total_length),
                bpm: parseFloat(b.bpm)
            })).sort((a, b) => a.difficulty_rating - b.difficulty_rating)
        };

        col[modeKey].unshift(setInfo);
        saveOsuCollection(col);

        status.innerText = t('osu_added', { n: `${setInfo.artist} - ${setInfo.title}`, m: OSU_MODE_LABELS[modeNum], k: setInfo.beatmaps.length });
        status.style.color = '#34d399';
        input.value = '';

        osuCurrentTab = modeKey;
        clearAllOsuTabActive();
        const targetTab = document.querySelector(`#osu-collection-tabs [data-mode="${modeKey}"]`);
        if (targetTab) targetTab.classList.add('active');
        renderOsuCollection();
    } catch (e) {
        console.error('osu! fetch error:', e);
        status.innerText = `連線失敗: ${e.message}`;
        status.style.color = '#ff5252';
    }
}

/* .osu-collection-tabs (Favorites/modes) and #osu-category-tabs-row (custom
   categories) are two separate rows but only one tab across both should
   ever be active at once — this clears both before applying the new one. */
function clearAllOsuTabActive() {
    document.getElementById('osu-collection-tabs')?.querySelectorAll('.osu-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('osu-category-tabs-row')?.querySelectorAll('.osu-tab').forEach(t => t.classList.remove('active'));
}

function switchOsuTab(mode, btn) {
    clearAllOsuTabActive();
    btn.classList.add('active');
    osuCurrentTab = mode;
    osuPage = 0;
    renderOsuCollection();
}

async function removeOsuSet(setId) {
    if (!await verifyOsuPassword()) return;
    const col = getOsuCollection();
    OSU_MODES.forEach(m => { col[m] = col[m].filter(s => s.beatmapset_id !== setId); });
    saveOsuCollection(col);
    renderOsuCollection();
}

async function refreshAllOsuSets() {
    if (!await verifyOsuPassword()) return;
    const btn = document.querySelector('.osu-refresh-all');
    const status = document.getElementById('osu-status');
    btn.classList.add('spinning');
    status.innerText = t('osu_refreshing');
    status.style.color = '#c8a2e0';

    const col = getOsuCollection();
    const allIds = [...new Set(OSU_MODES.flatMap(mode => col[mode].map(s => s.beatmapset_id)))];
    const REFRESH_CONCURRENCY = 6;

    try {
        for (let i = 0; i < allIds.length; i += REFRESH_CONCURRENCY) {
            const batch = allIds.slice(i, i + REFRESH_CONCURRENCY);
            const results = await Promise.all(batch.map(setId =>
                osuFetch(`s=${setId}`)
                    .then(beatmaps => ({ setId, beatmaps }))
                    .catch(() => ({ setId, beatmaps: [] }))
            ));
            for (const { setId, beatmaps } of results) {
                if (beatmaps.length === 0) continue;
                for (const mode of OSU_MODES) {
                    const idx = col[mode].findIndex(s => s.beatmapset_id === setId);
                    if (idx >= 0) {
                        col[mode][idx].beatmaps = beatmaps.map(b => ({
                            beatmap_id: parseInt(b.beatmap_id),
                            version: b.version,
                            difficulty_rating: parseFloat(b.difficultyrating),
                            hit_length: parseInt(b.hit_length),
                            total_length: parseInt(b.total_length),
                            bpm: parseFloat(b.bpm)
                        })).sort((a, b) => a.difficulty_rating - b.difficulty_rating);
                        break;
                    }
                }
            }
        }
        saveOsuCollection(col);
        renderOsuCollection();
        status.innerText = t('osu_refresh_done', { n: allIds.length });
        status.style.color = '#34d399';
    } catch (e) {
        console.error('Refresh all failed:', e);
        status.innerText = t('osu_refresh_fail');
        status.style.color = '#ff5252';
    } finally {
        btn.classList.remove('spinning');
    }
}

/* ===== Collection overview stats (total sets / favorites / star range) —
   purely derived from localStorage, no API calls needed. ===== */
function renderOsuStats() {
    const el = document.getElementById('osu-stats-panel');
    if (!el) return;
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m]).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });

    if (allSets.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = '';

    const allRatings = allSets.flatMap(s => s.beatmaps.map(b => b.difficulty_rating)).filter(r => r > 0);
    const avgRating = allRatings.length ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
    const maxRating = allRatings.length ? Math.max(...allRatings) : 0;
    const favCount = getOsuFavorites().filter(id => allSets.some(s => s.beatmapset_id === id)).length;

    el.innerHTML = `
        <div class="osu-stat">
            <div class="osu-stat-value">${allSets.length}</div>
            <div class="osu-stat-label">${t('osu_stats_total')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${favCount}</div>
            <div class="osu-stat-label">${t('osu_fav')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${avgRating.toFixed(2)}⭐</div>
            <div class="osu-stat-label">${t('osu_stats_avg_rating')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${maxRating.toFixed(2)}⭐</div>
            <div class="osu-stat-label">${t('osu_stats_max_rating')}</div>
        </div>
    `;
}

/* ===== Today's featured beatmap: a deterministic daily pick from the whole
   collection (all modes combined), so today's pick is the same across tabs/
   reloads but changes once a day — same pattern as the pjsekai/wuwa sibling
   sites' "featured character of the day". ===== */
function renderFeaturedBeatmap() {
    const el = document.getElementById('featured-beatmap-banner');
    if (!el) return;
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m].map(s => ({ ...s, __mode: m }))).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });

    if (allSets.length === 0) {
        el.style.display = 'none';
        return;
    }

    const dayIndex = Math.floor(Date.now() / 86400000) % allSets.length;
    const set = allSets[dayIndex];
    const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/cover.jpg`;

    el.style.display = 'flex';
    el.onclick = () => window.open(`https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}`, '_blank');
    el.innerHTML = `
        <div class="featured-beatmap-bg" style="background-image:url('${coverUrl}')"></div>
        <div class="featured-beatmap-overlay"></div>
        <div class="featured-beatmap-info">
            <div class="featured-beatmap-label">${t('featured_beatmap_label')}</div>
            <div class="featured-beatmap-title">${modeIconSvg(set.__mode)} ${set.title}</div>
            <div class="featured-beatmap-artist">${set.artist} · ${t('mapped_by', { n: set.creator })}</div>
        </div>
    `;
}

function renderOsuCollection() {
    const container = document.getElementById('osu-collection');
    const paginationEl = document.getElementById('osu-pagination');
    if (!container || !paginationEl) return;
    renderOsuStats();
    renderFeaturedBeatmap();
    renderOsuCategoryTabsRow();
    const col = getOsuCollection();
    let sets;

    if (!OSU_MODES.includes(osuCurrentTab)) {
        const memberIds = osuCurrentTab === 'favorites' ? getOsuFavorites() : getCategoryMemberIds(osuCurrentTab);
        const allSets = OSU_MODES.flatMap(m => col[m].map(s => ({ ...s, __mode: m })));
        const seen = new Set();
        sets = allSets.filter(s => {
            if (memberIds.includes(s.beatmapset_id) && !seen.has(s.beatmapset_id)) {
                seen.add(s.beatmapset_id);
                return true;
            }
            return false;
        });
    } else {
        const seen = new Set();
        sets = col[osuCurrentTab].filter(s => {
            if (seen.has(s.beatmapset_id)) return false;
            seen.add(s.beatmapset_id);
            return true;
        }).map(s => ({ ...s, __mode: osuCurrentTab }));
    }

    if (osuSearchQuery) {
        const q = osuSearchQuery.toLowerCase();
        sets = sets.filter(s =>
            s.title.toLowerCase().includes(q) ||
            s.artist.toLowerCase().includes(q) ||
            s.creator.toLowerCase().includes(q)
        );
    }

    sets = sortOsuSets(sets);

    if (sets.length === 0) {
        const msg = osuSearchQuery
            ? t('osu_search_empty')
            : osuCurrentTab === 'favorites'
                ? `${t('osu_empty_fav')}<br><span>${t('osu_empty_fav_hint')}</span>`
                : !OSU_MODES.includes(osuCurrentTab)
                    ? t('osu_empty_category')
                    : `${t('osu_empty_collection')}<br><span>${t('osu_empty_hint')}</span>`;
        container.innerHTML = `<div class="osu-empty">${msg}</div>`;
        paginationEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(sets.length / OSU_PAGE_SIZE);
    if (osuPage >= totalPages) osuPage = totalPages - 1;
    if (osuPage < 0) osuPage = 0;
    const pageSets = sets.slice(osuPage * OSU_PAGE_SIZE, (osuPage + 1) * OSU_PAGE_SIZE);

    container.innerHTML = pageSets.map(set => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/card.jpg`;
        const isFav = isOsuFavorited(set.beatmapset_id);
        const starsMin = Math.min(...set.beatmaps.map(b => b.difficulty_rating));
        const starsMax = Math.max(...set.beatmaps.map(b => b.difficulty_rating));
        const starsText = (starsMin === 0 && starsMax === 0) ? '' : `<div class="osu-card-stars">${starsMin.toFixed(2)}⭐~${starsMax.toFixed(2)}⭐</div>`;
        return `
        <div class="osu-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${set.beatmapset_id}, event)" title="複製 ID">📋</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${set.beatmapset_id}, event)" title="${t('osu_download_btn_title')}">⬇</button>
            <button class="osu-ppcalc-btn" onclick="openPpCalcModal(${set.beatmapset_id}, event)" title="${t('pp_calc_btn_title')}">📊</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${set.beatmapset_id}, event)" title="播放預覽">&#9654;</button>
            <button class="osu-fav-btn ${isFav ? 'active' : ''}" onclick="toggleOsuFavorite(${set.beatmapset_id}, event)" title="${isFav ? '取消最愛' : '加入最愛'}">♥</button>
            <button class="osu-category-btn" onclick="toggleCategoryPicker(${set.beatmapset_id}, event)" title="${t('osu_category_btn_title')}">🏷</button>
            <button class="osu-delete-btn" onclick="event.stopPropagation();removeOsuSet(${set.beatmapset_id})" title="移除">&#x2715;</button>
            <div class="osu-card-mode-badge">${modeIconSvg(set.__mode)}</div>
            <div class="osu-card-info">
                <div class="osu-card-title">${set.title}</div>
                ${starsText}
                <div class="osu-card-artist">${set.artist}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: set.creator })}</div>
            </div>
        </div>`;
    }).join('');

    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
    } else {
        let pages = '';
        pages += `<button class="osu-page-btn" onclick="osuPage=0;renderOsuCollection()" ${osuPage===0?'disabled':''}>«</button>`;
        pages += `<button class="osu-page-btn" onclick="osuPage=Math.max(0,osuPage-1);renderOsuCollection()" ${osuPage===0?'disabled':''}>‹</button>`;
        for (let i = 0; i < totalPages; i++) {
            pages += `<button class="osu-page-btn ${i===osuPage?'active':''}" onclick="osuPage=${i};renderOsuCollection()">${i+1}</button>`;
        }
        pages += `<button class="osu-page-btn" onclick="osuPage=Math.min(${totalPages-1},osuPage+1);renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>›</button>`;
        pages += `<button class="osu-page-btn" onclick="osuPage=${totalPages-1};renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>»</button>`;
        paginationEl.innerHTML = pages;
    }
}

const COUNTRY_NAMES = {
    TW: 'Taiwan', JP: 'Japan', KR: 'South Korea', US: 'United States',
    CN: 'China', HK: 'Hong Kong', RU: 'Russia', FR: 'France',
    DE: 'Germany', GB: 'United Kingdom', BR: 'Brazil', PH: 'Philippines',
    ID: 'Indonesia', TH: 'Thailand', PL: 'Poland', AU: 'Australia',
    CA: 'Canada', MX: 'Mexico', AR: 'Argentina', CL: 'Chile',
};

function calcOsuAccuracy(r, mode) {
    const c300 = parseInt(r.count300) || 0;
    const c100 = parseInt(r.count100) || 0;
    const c50 = parseInt(r.count50) || 0;
    const cmiss = parseInt(r.countmiss) || 0;
    const cgeki = parseInt(r.countgeki) || 0;
    const ckatu = parseInt(r.countkatu) || 0;
    let acc = 0;
    if (mode === 1) {
        const total = c300 + c100 + cmiss;
        acc = total > 0 ? (c300 + c100 * 0.5) / total : 0;
    } else if (mode === 2) {
        const total = c300 + c100 + c50 + cmiss + ckatu;
        acc = total > 0 ? (c300 + c100 + c50) / total : 0;
    } else if (mode === 3) {
        const total = cgeki + c300 + ckatu + c100 + c50 + cmiss;
        acc = total > 0 ? (cgeki * 300 + c300 * 300 + ckatu * 200 + c100 * 100 + c50 * 50) / (total * 300) : 0;
    } else {
        const total = c300 + c100 + c50 + cmiss;
        acc = total > 0 ? (c300 * 300 + c100 * 100 + c50 * 50) / (total * 300) : 0;
    }
    return (acc * 100).toFixed(2);
}

const OSU_RANK_CLASS = { XH: 'ss', X: 'ss', SH: 's', S: 's', A: 'a', B: 'b', C: 'c', D: 'd', F: 'f' };

function decodeOsuMods(bitmask) {
    bitmask = parseInt(bitmask) || 0;
    if (!bitmask) return [];
    const hasNC = !!(bitmask & 512);
    const hasPF = !!(bitmask & 16384);
    const table = [
        [1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'],
        [32, hasPF ? null : 'SD'], [64, hasNC ? null : 'DT'],
        [128, 'RX'], [256, 'HT'], [512, 'NC'], [1024, 'FL'],
        [4096, 'SO'], [8192, 'AP'], [16384, 'PF']
    ];
    return table.filter(([bit, name]) => name && (bitmask & bit)).map(([, name]) => name);
}

async function renderOsuRecentPlays(userId, mode, listId, wrapId) {
    const container = document.getElementById(listId);
    const wrap = document.getElementById(wrapId);
    if (!container || !wrap) return;
    wrap.style.display = 'none';
    try {
        const recent = await osuFetch(`recent=${userId}&limit=5&m=${mode}`);
        if (!recent || recent.length === 0) return;
        const beatmapIds = [...new Set(recent.map(r => r.beatmap_id))];
        const beatmapResults = await Promise.all(beatmapIds.map(id => osuFetch(`b=${id}`)));
        const beatmapMap = {};
        beatmapIds.forEach((id, i) => {
            const bm = beatmapResults[i] && beatmapResults[i][0];
            if (bm) beatmapMap[id] = bm;
        });
        container.innerHTML = recent.map(r => {
            const bm = beatmapMap[r.beatmap_id];
            const title = bm ? `${bm.title} [${bm.version}]` : `Beatmap #${r.beatmap_id}`;
            const coverUrl = bm ? `https://assets.ppy.sh/beatmaps/${bm.beatmapset_id}/covers/card.jpg` : '';
            const acc = calcOsuAccuracy(r, mode);
            const rankClass = OSU_RANK_CLASS[r.rank] || 'f';
            const mods = decodeOsuMods(r.enabled_mods);
            const modsStr = mods.length > 0 ? ' · ' + mods.join(',') : '';
            const d = new Date(String(r.date).replace(' ', 'T') + 'Z');
            const dateStr = isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `<a class="osu-recent-item" href="https://osu.ppy.sh/b/${r.beatmap_id}" target="_blank" rel="noopener noreferrer">
                <div class="osu-recent-bg" style="background-image:url('${coverUrl}')"></div>
                <div class="osu-recent-overlay"></div>
                <span class="osu-recent-rank rank-${rankClass}">${r.rank || '—'}</span>
                <div class="osu-recent-info">
                    <div class="osu-recent-song">${escHtml(title)}</div>
                    <div class="osu-recent-meta">${acc}% · ${r.maxcombo}x${modsStr} · ${dateStr}</div>
                </div>
            </a>`;
        }).join('');
        wrap.style.display = 'block';
    } catch (e) {
        console.error('Recent plays fetch failed:', e);
    }
}

/* ===== PP growth trend: daily localStorage snapshots of total PP, rendered
   as a small SVG line chart. There's no historical PP endpoint on the osu!
   v1 API, so this alone only accumulates data from whenever a visitor first
   loads the site forward. To backfill actual past progress, fetchOsuTrackHistory()
   below pulls per-mode history from the osu!Track API (github.com/Ameobea/osutrack-api,
   proxied through netlify/functions/osu-pp-history.js) and merges it in. ===== */
const OSU_PP_HISTORY_MAX_DAYS = 90;

/* Each looked-up/logged-in visitor gets their own PP history bucket in
   localStorage, keyed by osu! user id, so the functions below all take the
   storage key as a parameter (see loadVisitorProfileById). */
function ppHistoryKeyFor(userId) {
    return `osu_pp_history_${userId}`;
}

function getPpHistory(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
}

function savePpHistory(history, key) {
    localStorage.setItem(key, JSON.stringify(history));
}

function recordPpSnapshot(totalPP, key) {
    const today = new Date().toISOString().slice(0, 10);
    const value = Math.round(totalPP);
    const history = getPpHistory(key);
    const last = history[history.length - 1];
    if (last && last.date === today && last.pp === value) return;
    if (last && last.date === today) history[history.length - 1] = { date: today, pp: value };
    else history.push({ date: today, pp: value });
    savePpHistory(history.length > OSU_PP_HISTORY_MAX_DAYS ? history.slice(-OSU_PP_HISTORY_MAX_DAYS) : history, key);
}

function formatPpChartDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* Reads theme colors fresh each render/redraw since Chart.js bakes them
   into canvas pixels rather than resolving CSS var() live like the old SVG
   version did — see the theme-toggle listener below renderPpHistoryChart. */
function ppChartColors() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
        accent: pick('--accent-pink', '#f472b6'),
        grid: pick('--border-light', 'rgba(255,255,255,0.15)'),
        label: pick('--text-label', 'rgba(255,255,255,0.6)'),
        text: pick('--text', '#fff'),
        tooltipBg: pick('--bg-card', 'rgba(25,15,45,0.95)'),
    };
}

/* Fetches per-mode stats_history from osu!Track for the given user and
   collapses it to one daily total-PP point per day: each mode's history is
   bucketed to its last value per calendar day, then summed across modes with
   forward-fill (a mode with no update that day keeps its last known value)
   so a day only shown for e.g. taiko still counts the visitor's standard pp. */
async function fetchOsuTrackHistory(userId) {
    const perMode = await Promise.all([0, 1, 2, 3].map(async mode => {
        try {
            const res = await fetch(`/.netlify/functions/osu-pp-history?user=${userId}&mode=${mode}`);
            if (!res.ok) return new Map();
            const data = await res.json();
            const entries = (Array.isArray(data) ? data : [])
                .filter(e => e.pp_raw != null && e.timestamp)
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const byDay = new Map();
            for (const e of entries) byDay.set(e.timestamp.slice(0, 10), parseFloat(e.pp_raw));
            return byDay;
        } catch { return new Map(); }
    }));

    const allDates = [...new Set(perMode.flatMap(m => [...m.keys()]))].sort();
    const lastKnown = [null, null, null, null];
    const totals = [];
    for (const date of allDates) {
        let sum = 0, hasAny = false;
        for (let i = 0; i < 4; i++) {
            if (perMode[i].has(date)) lastKnown[i] = perMode[i].get(date);
            if (lastKnown[i] != null) { sum += lastKnown[i]; hasAny = true; }
        }
        if (hasAny) totals.push({ date, pp: Math.round(sum) });
    }
    return totals;
}

function mergePpHistory(remote, local) {
    const byDate = new Map(remote.map(p => [p.date, p.pp]));
    for (const p of local) byDate.set(p.date, p.pp);
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, pp]) => ({ date, pp }));
}

/* Single shared Chart.js instance — only one pp-history panel (the visitor
   lookup card) is ever on screen at a time, so each render destroys the
   previous chart before creating the next rather than tracking one per
   panelId. */
let ppHistoryChart = null;
let ppHistoryChartArgs = null;

function renderPpHistoryChart(historyOverride, key, panelId) {
    const el = document.getElementById(panelId);
    if (!el) return;
    const history = historyOverride || getPpHistory(key);

    if (ppHistoryChart) { ppHistoryChart.destroy(); ppHistoryChart = null; }

    if (history.length < 2) {
        ppHistoryChartArgs = null;
        el.innerHTML = `
            <div class="trend-chart-label">${t('pp_history_title')}</div>
            <p class="osu-empty">${t('pp_history_empty')}</p>
        `;
        return;
    }

    ppHistoryChartArgs = [historyOverride, key, panelId];
    el.innerHTML = `
        <div class="trend-chart-label">${t('pp_history_title')}</div>
        <div class="trend-chart-wrap"><canvas></canvas></div>
    `;
    const canvas = el.querySelector('canvas');
    const colors = ppChartColors();

    ppHistoryChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: history.map(p => formatPpChartDate(p.date)),
            datasets: [{
                data: history.map(p => p.pp),
                borderColor: colors.accent,
                backgroundColor: colors.accent + '2a',
                pointBackgroundColor: colors.accent,
                pointBorderColor: colors.accent,
                pointRadius: 2.5,
                pointHoverRadius: 5,
                borderWidth: 2,
                tension: 0.25,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.accent,
                    borderColor: colors.grid,
                    borderWidth: 1,
                    padding: 8,
                    displayColors: false,
                    callbacks: { label: ctx => `${ctx.parsed.y.toLocaleString()}pp` },
                },
            },
            scales: {
                x: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.label, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.label, font: { size: 10 }, callback: v => v.toLocaleString() },
                },
            },
        },
    });
}

/* Re-render with fresh colors on theme toggle so the chart doesn't keep
   its old-theme palette baked into the canvas (unlike the previous SVG
   version, which resolved CSS var() live and needed no such hook). */
(function () {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    themeBtn.addEventListener('click', () => setTimeout(() => {
        if (ppHistoryChartArgs) renderPpHistoryChart(...ppHistoryChartArgs);
    }, 0));
})();

/* ===== Visitor Profile Lookup ===== */
let visitorLookupUserId = null;
let visitorModeData = [];
let visitorCurrentMode = 0;

function switchVisitorRecentMode(mode, el) {
    document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    visitorCurrentMode = mode;
    if (visitorLookupUserId) renderOsuRecentPlays(visitorLookupUserId, mode, 'visitor-recent-list', 'visitor-recent-plays');
}

async function loadVisitorProfileById(input, isUsername) {
    const status = document.getElementById('visitor-lookup-status');
    const result = document.getElementById('visitor-lookup-result');
    status.innerText = t('osu_searching') || 'Searching...';
    status.style.color = '#f9a8d4';
    result.style.display = 'none';

    const param = isUsername ? `u=${encodeURIComponent(input)}&type=string` : `u=${input}`;

    try {
        const results = await Promise.all([0,1,2,3].map(m => osuFetch(`${param}&m=${m}`)));
        const modeData = results.map(r => (r && r.length > 0) ? r[0] : null);
        visitorModeData = modeData;
        visitorCurrentMode = 0;
        const u = modeData[0];
        if (!u) { status.innerText = t('osu_not_found') || 'Not found'; status.style.color = '#ff5252'; return; }

        status.innerText = '';
        document.getElementById('visitor-avatar').src = osuAvatarUrl(u.user_id);
        document.getElementById('visitor-result-name').textContent = u.username;
        document.getElementById('visitor-result-country').textContent = COUNTRY_NAMES[u.country] || u.country;

        const grid = document.getElementById('visitor-modes-grid');
        grid.innerHTML = modeData.map((m, i) => {
            const label = `${modeIconSvg(OSU_MODES[i])} ${OSU_MODE_LABELS[i]}`;
            if (!m || m.pp_raw == null) return `<div class="visitor-mode-mini"><div class="visitor-mode-name">${label}</div><div class="visitor-mode-pp">—</div></div>`;
            return `<div class="visitor-mode-mini"><div class="visitor-mode-name">${label}</div><div class="visitor-mode-pp">${Math.round(parseFloat(m.pp_raw)).toLocaleString()}</div></div>`;
        }).join('');

        const totalPP = modeData.reduce((sum, m) => sum + (m && m.pp_raw != null ? parseFloat(m.pp_raw) : 0), 0);
        document.getElementById('visitor-total-pp-value').textContent = Math.round(totalPP).toLocaleString();
        result.style.display = 'block';

        visitorLookupUserId = u.user_id;
        document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('#visitor-recent-mode-tabs .osu-mode-tab[data-mode="0"]').classList.add('active');
        renderOsuRecentPlays(u.user_id, 0, 'visitor-recent-list', 'visitor-recent-plays');

        if (totalPP > 0) {
            const key = ppHistoryKeyFor(u.user_id);
            recordPpSnapshot(totalPP, key);
            renderPpHistoryChart(null, key, 'visitor-pp-history-panel');
            fetchOsuTrackHistory(u.user_id).then(remote => {
                if (remote.length) renderPpHistoryChart(mergePpHistory(remote, getPpHistory(key)), key, 'visitor-pp-history-panel');
            });
        }
    } catch (e) {
        console.error('Visitor lookup failed:', e);
        status.innerText = 'Error';
        status.style.color = '#ff5252';
    }
}

async function lookupVisitorProfile() {
    const input = document.getElementById('visitor-lookup-input').value.trim();
    if (!input) return;
    loadVisitorProfileById(input, !/^\d+$/.test(input));
}

/* ===== osu! OAuth login =====
   netlify/functions/osu-login.js + osu-callback.js run the authorization-code
   flow and redirect back here with ?osu_login=<id>&osu_login_name=<name> (or
   ?osu_login_error=1 on failure) — the access token itself is never handed to
   the client or stored anywhere, since the id is all loadVisitorProfileById()
   needs to personalize the Lookup tab the same way a manual search does. */
const OSU_LOGIN_STORAGE_KEY = 'osu_logged_in_user';

function getLoggedInOsuUser() {
    try { return JSON.parse(localStorage.getItem(OSU_LOGIN_STORAGE_KEY)); }
    catch { return null; }
}

function logoutOsuUser() {
    localStorage.removeItem(OSU_LOGIN_STORAGE_KEY);
    applyLoggedInOsuUser();
}

function applyLoggedInOsuUser() {
    const user = getLoggedInOsuUser();
    const loginBtn = document.getElementById('osu-login-btn');
    const pill = document.getElementById('osu-logged-in-pill');
    if (!loginBtn || !pill) return;

    loginBtn.style.display = user ? 'none' : '';
    pill.style.display = user ? '' : 'none';
    if (!user) return;

    document.getElementById('osu-logged-in-name').textContent = user.username || `#${user.id}`;
    document.getElementById('osu-logged-in-avatar').src = osuAvatarUrl(user.id);

    const input = document.getElementById('visitor-lookup-input');
    if (input) input.value = user.id;
    loadVisitorProfileById(user.id, false);
}

function checkOsuLoginFromUrl() {
    const params = new URLSearchParams(location.search);
    const id = params.get('osu_login');
    const loginFailed = params.get('osu_login_error');

    if (id) {
        localStorage.setItem(OSU_LOGIN_STORAGE_KEY, JSON.stringify({
            id,
            username: params.get('osu_login_name') || '',
            token: params.get('osu_login_token') || null,
        }));
    }
    if (id || loginFailed) {
        params.delete('osu_login');
        params.delete('osu_login_name');
        params.delete('osu_login_token');
        params.delete('osu_login_error');
        const qs = params.toString();
        history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
        if (loginFailed) showShareToast(t('osu_login_fail'));
    }

    applyLoggedInOsuUser();
}

/* Signed proof of identity for the currently logged-in osu! user (see
   netlify/functions/_auth-token.js) — null for visitors who logged in before
   this existed, until they log in again. Only needed for actions that write
   public data under the visitor's name (collections-publish/unpublish). */
function getOsuAuthToken() {
    const user = getLoggedInOsuUser();
    return user && user.token ? user.token : null;
}

/* ===== PP calculator + strain graph =====
   Recomputes stars/PP for arbitrary mods/accuracy and renders a difficulty-
   over-time curve, via the osu-pp function (rosu-pp-js parsing the raw .osu
   file server-side — the v1 API used elsewhere in this file has no mod-aware
   recalculation or strain data). */
function findOsuSetById(setId) {
    const col = getOsuCollection();
    for (const mode of OSU_MODES) {
        const found = col[mode].find(s => s.beatmapset_id === setId);
        if (found) return found;
    }
    return null;
}

const PP_MOD_GROUPS = {
    DT: ['DT', 'NC', 'HT'], NC: ['DT', 'NC', 'HT'], HT: ['DT', 'NC', 'HT'],
    EZ: ['EZ', 'HR'], HR: ['EZ', 'HR'],
    SD: ['SD', 'PF'], PF: ['SD', 'PF'],
};
const PP_MOD_LIST = ['EZ', 'HR', 'HD', 'HT', 'DT', 'NC', 'FL', 'SD', 'PF', 'NF'];

let ppCalcState = null;

function openPpCalcModal(setId, event) {
    if (event) event.stopPropagation();
    const set = findOsuSetById(setId);
    if (!set || !set.beatmaps.length) return;

    const hardest = set.beatmaps[set.beatmaps.length - 1];
    ppCalcState = { setId, beatmapId: hardest.beatmap_id, mods: new Set() };

    document.getElementById('pp-calc-title').textContent = `${set.artist} - ${set.title}`;
    document.getElementById('pp-calc-diff-select').innerHTML = set.beatmaps.map(b =>
        `<option value="${b.beatmap_id}" ${b.beatmap_id === hardest.beatmap_id ? 'selected' : ''}>${escHtml(b.version)} (${b.difficulty_rating.toFixed(2)}★)</option>`
    ).join('');

    document.getElementById('pp-calc-acc').value = 100;
    document.getElementById('pp-calc-status').innerText = '';
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
    renderPpCalcMods();

    document.getElementById('pp-calc-modal').style.display = 'flex';
}

function closePpCalcModal() {
    document.getElementById('pp-calc-modal').style.display = 'none';
}

function selectPpCalcDiff(beatmapIdStr) {
    if (!ppCalcState) return;
    ppCalcState.beatmapId = parseInt(beatmapIdStr);
    document.getElementById('pp-calc-status').innerText = '';
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
}

function togglePpCalcMod(mod) {
    if (!ppCalcState) return;
    const group = PP_MOD_GROUPS[mod];
    if (ppCalcState.mods.has(mod)) {
        ppCalcState.mods.delete(mod);
    } else {
        if (group) group.forEach(m => ppCalcState.mods.delete(m));
        ppCalcState.mods.add(mod);
    }
    renderPpCalcMods();
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
}

function renderPpCalcMods() {
    document.getElementById('pp-calc-mods-row').innerHTML = PP_MOD_LIST.map(mod =>
        `<button type="button" class="pp-calc-mod-chip ${ppCalcState.mods.has(mod) ? 'active' : ''}" onclick="togglePpCalcMod('${mod}')">${mod}</button>`
    ).join('');
}

async function osuPpFetch(beatmapId, mods, accList, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const params = new URLSearchParams({ id: beatmapId, mods, acc: accList.join(',') });
    let res;
    try {
        res = await fetch(`/.netlify/functions/osu-pp?${params.toString()}`, { signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`${timeoutMs / 1000}s timeout`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
}

async function runPpCalc() {
    if (!ppCalcState) return;
    const acc = parseFloat(document.getElementById('pp-calc-acc').value);
    const status = document.getElementById('pp-calc-status');
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';

    if (!Number.isFinite(acc) || acc < 0 || acc > 100) {
        status.innerText = t('pp_calc_acc_invalid');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('pp_calc_calculating');
    status.style.color = '#c8a2e0';

    const accList = [...new Set([acc, 95, 98, 100])].sort((a, b) => a - b);
    const modsStr = [...ppCalcState.mods].join('');

    try {
        const data = await osuPpFetch(ppCalcState.beatmapId, modsStr, accList);
        status.innerText = '';
        renderPpCalcResult(data);
    } catch (e) {
        console.error('PP calc failed:', e);
        status.innerText = `${t('pp_calc_error')}${e.message ? ' (' + e.message + ')' : ''}`;
        status.style.color = '#ff5252';
    }
}

function strainChartSvg(values, sectionLengthMs) {
    const width = 600, height = 140;
    const padL = 6, padR = 6, padT = 10, padB = 20;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = values.length;
    const maxV = Math.max(1, ...values);

    const xPos = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
    const yPos = v => padT + innerH - (v / maxV) * innerH;

    const pts = values.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ');
    const areaPts = `${padL},${padT + innerH} ${pts} ${padL + innerW},${padT + innerH}`;

    const totalSec = Math.round((n * sectionLengthMs) / 1000);
    const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    const baseline = `<line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" class="trend-chart-grid" />`;
    const xLabels = `<text x="${padL}" y="${height - 4}" text-anchor="start" class="trend-chart-axis-label">0:00</text>
        <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="trend-chart-axis-label">${fmtTime(totalSec)}</text>`;

    return `<svg viewBox="0 0 ${width} ${height}" class="strain-chart-svg" preserveAspectRatio="none">
        <polygon points="${areaPts}" class="strain-chart-fill" />
        <polyline points="${pts}" class="strain-chart-line" />
        ${baseline}${xLabels}
    </svg>`;
}

function renderPpCalcResult(data) {
    const resultEl = document.getElementById('pp-calc-result');
    const boxes = [`<div class="osu-stat"><div class="osu-stat-value">${data.stars.toFixed(2)}⭐</div><div class="osu-stat-label">${t('pp_calc_stars_label')}</div></div>`];
    Object.keys(data.pp).map(Number).sort((a, b) => a - b).forEach(acc => {
        boxes.push(`<div class="osu-stat"><div class="osu-stat-value">${Math.round(data.pp[acc])}pp</div><div class="osu-stat-label">${acc}%</div></div>`);
    });
    resultEl.innerHTML = boxes.join('');
    resultEl.style.display = 'grid';

    const graphWrap = document.getElementById('pp-calc-graph-wrap');
    if (data.strains && data.strains.values && data.strains.values.length) {
        graphWrap.innerHTML = `<div class="pp-calc-section-label">${t('pp_calc_strain_title')}</div>
            <div class="trend-chart-wrap">${strainChartSvg(data.strains.values, data.strains.sectionLength)}</div>`;
    } else {
        graphWrap.innerHTML = `<p class="osu-empty">${t('pp_calc_strain_unsupported')}</p>`;
    }
    graphWrap.style.display = 'block';
}

/* ===== Shareable PNG cards =====
   Builds a themed card off-screen as real DOM/CSS (see .share-card in
   css/osu.css), rasterizes it with html-to-image, then downloads it as a
   PNG. Using real DOM instead of hand-rolled canvas drawing means the card
   markup can be restyled with plain CSS. Colors are fixed rather than
   theme-token-driven so an exported image looks the same regardless of the
   viewer's dark/light mode. */
function buildStatTile(value, label) {
    const tile = document.createElement('div');
    tile.className = 'osu-stat';
    const v = document.createElement('div');
    v.className = 'osu-stat-value';
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'osu-stat-label';
    l.textContent = label;
    tile.append(v, l);
    return tile;
}

function buildShareCard({ title, avatarUrl, name, sub, stats }) {
    const card = document.createElement('div');
    card.className = 'share-card';

    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'share-card-title';
        titleEl.textContent = title;
        card.appendChild(titleEl);
    }

    if (name) {
        const header = document.createElement('div');
        header.className = 'share-card-header';
        if (avatarUrl) {
            const img = document.createElement('img');
            img.className = 'share-card-avatar';
            img.src = avatarUrl;
            header.appendChild(img);
        }
        const info = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'share-card-name';
        nameEl.textContent = name;
        info.appendChild(nameEl);
        if (sub) {
            const subEl = document.createElement('div');
            subEl.className = 'share-card-sub';
            subEl.textContent = sub;
            info.appendChild(subEl);
        }
        header.appendChild(info);
        card.appendChild(header);
    }

    const grid = document.createElement('div');
    grid.className = 'share-card-stats';
    stats.forEach(([label, value]) => grid.appendChild(buildStatTile(value, label)));
    card.appendChild(grid);

    const footer = document.createElement('div');
    footer.className = 'share-card-footer';
    footer.textContent = location.host;
    card.appendChild(footer);

    return card;
}

async function downloadShareCardPng(card, filename, doneMsg, failMsg) {
    document.body.appendChild(card);
    try {
        const dataUrl = await htmlToImage.toPng(card, { pixelRatio: 2, cacheBust: true });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();
        showShareToast(doneMsg);
    } catch (e) {
        console.error('Share card generation failed:', e);
        showShareToast(failMsg);
    } finally {
        card.remove();
    }
}

async function downloadStatsCardFor(u, mode) {
    if (!u) return;
    const card = buildShareCard({
        avatarUrl: osuAvatarUrl(u.user_id),
        name: u.username,
        sub: `${COUNTRY_NAMES[u.country] || u.country} · ${OSU_MODE_LABELS[mode]}`,
        stats: [
            [t('osu_stat_global'), u.pp_rank != null ? '#' + parseInt(u.pp_rank).toLocaleString() : '—'],
            ['PP', u.pp_raw != null ? Math.round(parseFloat(u.pp_raw)).toLocaleString() : '—'],
            [t('osu_stat_accuracy'), u.accuracy != null ? parseFloat(u.accuracy).toFixed(2) + '%' : '—'],
            [t('osu_stat_playcount'), u.playcount != null ? parseInt(u.playcount).toLocaleString() : '—'],
        ],
    });
    await downloadShareCardPng(card, `osu-stats-${u.username}-${OSU_MODE_LABELS[mode]}.png`, t('stats_card_done'), t('stats_card_fail'));
}

function downloadVisitorStatsCard() {
    downloadStatsCardFor(visitorModeData[visitorCurrentMode], visitorCurrentMode);
}

/* ===== Shareable collection card =====
   Same off-screen html-to-image approach as the PP stats card above, but
   summarizing the local Beatmap collection instead of an osu! profile —
   purely derived from localStorage, no API calls needed. */
async function downloadCollectionShareCard() {
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m]).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });
    if (allSets.length === 0) {
        showShareToast(t('osu_share_link_empty'));
        return;
    }

    const allRatings = allSets.flatMap(s => s.beatmaps.map(b => b.difficulty_rating)).filter(r => r > 0);
    const avgRating = allRatings.length ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
    const maxRating = allRatings.length ? Math.max(...allRatings) : 0;
    const favCount = getOsuFavorites().filter(id => allSets.some(s => s.beatmapset_id === id)).length;

    const card = buildShareCard({
        title: t('collection_card_title'),
        stats: [
            [t('osu_stats_total'), allSets.length],
            [t('osu_fav'), favCount],
            [t('osu_stats_avg_rating'), avgRating.toFixed(2) + '⭐'],
            [t('osu_stats_max_rating'), maxRating.toFixed(2) + '⭐'],
        ],
    });
    await downloadShareCardPng(card, `osu-collection-${Date.now()}.png`, t('collection_card_done'), t('collection_card_fail'));
}
