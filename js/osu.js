/* ===== Small helpers ported from the main site's js/quiz.js (osu.js's only
   two external dependencies there) — inlined here since this site doesn't
   load quiz.js. ===== */
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/* Builds the numbered-button portion of a pagination bar, collapsing long
   runs into a "…" — used by this file, public-collections.js and
   farm-maps.js, all of which can page into the hundreds/thousands and would
   otherwise render one button per page. Keeps first/last page plus a small
   window around the current page always reachable. onClickForPage(i) returns
   the onclick JS for page i (each caller wires it to its own page-load fn). */
function buildPaginationPageButtons(currentPage, totalPages, onClickForPage) {
    const windowSize = 2;
    const pageSet = new Set([0, totalPages - 1]);
    for (let i = currentPage - windowSize; i <= currentPage + windowSize; i++) {
        if (i >= 0 && i < totalPages) pageSet.add(i);
    }
    const sorted = [...pageSet].sort((a, b) => a - b);

    let html = '';
    let prev = null;
    sorted.forEach(i => {
        if (prev !== null && i - prev > 1) {
            html += `<span class="osu-page-ellipsis">…</span>`;
        }
        html += `<button class="osu-page-btn ${i === currentPage ? 'active' : ''}" onclick="${onClickForPage(i)}">${i + 1}</button>`;
        prev = i;
    });
    return html;
}

/* ===== osu! Collection ===== */
const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const OSU_MODE_NAMES = { 0: 'standard', 1: 'taiko', 2: 'catch', 3: 'mania' };
const OSU_MODE_LABELS = ['Standard', 'Taiko', 'Catch', 'Mania'];
// This site's frontend mode keys differ from osu!'s own API/URL mode strings
// (see also FARM_MODE_TO_API in js/farm-maps.js, same mapping).
const OSU_API_MODE = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };

// osu! API v2 LanguageEnum id -> flag emoji + i18n key (see
// netlify/functions/osu-beatmapset.js). Names resolve through t() so the
// card badge follows the site UI language; the API's own English name is
// the fallback when a locale is missing the key.
const OSU_LANGUAGES = {
    1:  { flag: '🌐', key: 'lang_unspecified' },
    2:  { flag: '🇬🇧', key: 'lang_english' },
    3:  { flag: '🇯🇵', key: 'lang_japanese' },
    4:  { flag: '🇨🇳', key: 'lang_chinese' },
    5:  { flag: '🎵', key: 'lang_instrumental' },
    6:  { flag: '🇰🇷', key: 'lang_korean' },
    7:  { flag: '🇫🇷', key: 'lang_french' },
    8:  { flag: '🇩🇪', key: 'lang_german' },
    9:  { flag: '🇸🇪', key: 'lang_swedish' },
    10: { flag: '🇪🇸', key: 'lang_spanish' },
    11: { flag: '🇮🇹', key: 'lang_italian' },
    12: { flag: '🇷🇺', key: 'lang_russian' },
    13: { flag: '🇵🇱', key: 'lang_polish' },
    14: { flag: '🏳️', key: 'lang_other' },
};
function osuLangEntry(set) { return set && set.language ? OSU_LANGUAGES[set.language.id] : null; }
function osuLangFlag(set) { const e = osuLangEntry(set); return e ? e.flag : '🌐'; }
function osuLangName(set) {
    const e = osuLangEntry(set);
    if (e) return t(e.key);
    return (set && set.language && set.language.name) || '';
}

const MODE_ICON_PATHS = {
    standard: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="50" r="22" fill="currentColor" stroke="none"/>',
    taiko: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="50" r="29"/><line x1="50" y1="21" x2="50" y2="79"/>',
    catch: '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="38" r="7" fill="currentColor" stroke="none"/><circle cx="38" cy="60" r="5.5" fill="currentColor" stroke="none"/><circle cx="62" cy="60" r="5.5" fill="currentColor" stroke="none"/>',
    mania: '<circle cx="50" cy="50" r="41"/><rect x="31" y="39" width="8" height="22" rx="4" fill="currentColor" stroke="none"/><rect x="42" y="31" width="8" height="38" rx="4" fill="currentColor" stroke="none"/><rect x="53" y="31" width="8" height="38" rx="4" fill="currentColor" stroke="none"/><rect x="64" y="39" width="8" height="22" rx="4" fill="currentColor" stroke="none"/>'
};
function modeIconSvg(mode, color) {
    const path = MODE_ICON_PATHS[mode];
    if (!path) return '';
    const style = color ? ` style="color:${color}"` : '';
    return `<svg class="mode-icon-inline"${style} viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6">${path}</svg>`;
}

/* Star-rating colour scale matching osu!'s own beatmap pages (light blue for
   low SR, shifting through green/yellow/red/purple up to near-black for very
   high SR). Stops taken from osu-web's difficulty colour table. */
const STAR_COLOR_STOPS = [
    [0.1, [79, 192, 255]],
    [1.25, [79, 192, 255]],
    [2.0, [79, 255, 213]],
    [2.5, [124, 255, 79]],
    [3.3, [246, 240, 92]],
    [4.2, [255, 128, 104]],
    [4.9, [255, 78, 111]],
    [5.8, [198, 69, 184]],
    [6.7, [101, 99, 222]],
    [7.7, [24, 21, 142]],
    [9.0, [0, 0, 0]],
];
/* osu!'s own colour table runs all the way to near-black at the high-SR end,
   which reads fine on their white beatmap pages but disappears against this
   site's dark card backgrounds. Lift any colour below a minimum luminance by
   mixing it toward white by just enough to hit that floor exactly (mixing is
   linear in each channel, so this ratio is exact, not approximate) — keeps
   the hue direction (still reads as "the dark end") while staying visible. */
function liftForContrast(rgb, minLum = 92) {
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    if (lum >= minLum) return rgb;
    const r = (minLum - lum) / (255 - lum);
    return rgb.map(v => v + (255 - v) * r);
}
function starRatingColor(stars) {
    stars = Number(stars) || 0;
    const stops = STAR_COLOR_STOPS;
    if (stars <= 0) return '#888';
    if (stars <= stops[0][0]) return rgbHex(liftForContrast(stops[0][1]));
    for (let i = 1; i < stops.length; i++) {
        if (stars <= stops[i][0]) {
            const [s0, c0] = stops[i - 1];
            const [s1, c1] = stops[i];
            const t = (stars - s0) / (s1 - s0);
            return rgbHex(liftForContrast(c0.map((v, idx) => v + (c1[idx] - v) * t)));
        }
    }
    return rgbHex(liftForContrast(stops[stops.length - 1][1]));
}
function rgbHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/* Mode icon tinted by star rating, with a native hover tooltip showing the
   exact SR (and optional difficulty name) — mirrors osu!'s own beatmap page.
   Pass `url` to make the icon itself jump straight to that difficulty on
   osu! (stopping the click from also bubbling to the card's own onclick). */
function modeDiffIcon(mode, stars, label, url) {
    const color = starRatingColor(stars);
    const starsStr = (Number(stars) || 0).toFixed(2);
    // nbsp between the value and the star so "5.23 ⭐" never wraps apart.
    const titleText = label ? `${label} ${starsStr} ⭐` : `${starsStr} ⭐`;
    const clickAttr = url ? ` onclick="event.stopPropagation();window.open('${url}','_blank')" style="cursor:pointer"` : '';
    return `<span class="mode-diff-icon" title="${escHtml(titleText)}"${clickAttr}>${modeIconSvg(mode, color)}</span>`;
}
let osuCurrentTab = 'standard';
let osuCurrentAudio = null;
let osuVolume = 0.4;
let osuPage = 0;
let osuSortMode = 'default';
let osuSearchQuery = '';
let osuLangFilter = 'all';   // 'all' | 'unknown' | '<language id>'
const OSU_PAGE_SIZE = 8;
// Populated by renderOsuCollection() on every render — the current page's
// sets, one representative (hardest-visible-difficulty) beatmap id + mode
// each, for checkCollectionPlayedStatus() to check against. See its own
// comment at the assignment site for why it's per-set, not per-difficulty.
let osuPageCheckTargets = [];

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

function switchOsuLangFilter(v) {
    osuLangFilter = v;
    osuPage = 0;
    renderOsuCollection();
}

/* Rebuilds #osu-lang-filter's options from the languages present in `sets`
   (+ "all", + "unlabeled" if any set has no language yet), keeping the
   current selection. Called from renderOsuCollection() so it also
   re-localizes on a language switch (refreshDynamicContent -> renderOsuCollection). */
function renderOsuLangFilterOptions(sets) {
    const sel = document.getElementById('osu-lang-filter');
    if (!sel) return;
    const ids = new Set();
    let hasUnknown = false;
    for (const s of sets) {
        if (s.language && s.language.id) ids.add(s.language.id);
        else hasUnknown = true;
    }
    const ordered = [...ids].sort((a, b) => a - b);
    let html = `<option value="all">${t('osu_lang_filter_all')}</option>`;
    for (const id of ordered) {
        const e = OSU_LANGUAGES[id];
        const name = e ? t(e.key) : String(id);
        const flag = e ? e.flag : '🌐';
        html += `<option value="${id}">${flag} ${escHtml(name)}</option>`;
    }
    if (hasUnknown) html += `<option value="unknown">🌐 ${t('lang_unknown')}</option>`;
    if (osuLangFilter !== 'all' && osuLangFilter !== 'unknown' && !ids.has(Number(osuLangFilter))) {
        osuLangFilter = 'all';   // selected language no longer present (tab switch / removal)
    }
    sel.innerHTML = html;
    sel.value = osuLangFilter;
}

/* Pulls a set's language + genre from API v2 (see
   netlify/functions/osu-beatmapset.js). Never throws — a null result just
   means the fields stay unset and the next backfill pass retries. */
async function fetchOsuSetMeta(setId) {
    try {
        const r = await fetch(`/.netlify/functions/osu-beatmapset?id=${setId}`);
        if (!r.ok) return null;
        const d = await r.json();
        return { language: d.language || null, genre: d.genre || null };
    } catch {
        return null;
    }
}

// Guards backfillOsuLanguages() against overlapping itself or a manual
// refreshAllOsuSets().
let osuMetaBackfillRunning = false;

/* Fills in `language`/`genre` for collection sets saved before this feature
   existed. Runs a capped, gently-paced batch on page load (see js/main.js
   init) so a large collection tops up over a few visits rather than firing
   hundreds of API calls at once. New adds and "Refresh all" fetch the meta
   inline, so this only ever has old data to catch up on. */
async function backfillOsuLanguages() {
    if (osuMetaBackfillRunning) return;
    const col = getOsuCollection();
    const seen = new Set();
    const pending = [];
    for (const mode of OSU_MODES) {
        for (const s of col[mode]) {
            if (s.language || seen.has(s.beatmapset_id)) continue;
            seen.add(s.beatmapset_id);
            pending.push(s.beatmapset_id);
        }
    }
    if (pending.length === 0) return;

    osuMetaBackfillRunning = true;
    const MAX_PER_VISIT = 24, CHUNK = 4, PAUSE_MS = 800;
    const batch = pending.slice(0, MAX_PER_VISIT);
    try {
        for (let i = 0; i < batch.length; i += CHUNK) {
            const ids = batch.slice(i, i + CHUNK);
            const metas = await Promise.all(ids.map(id =>
                fetchOsuSetMeta(id).then(m => ({ id, m }))
            ));
            const fresh = getOsuCollection();
            let changed = false;
            for (const { id, m } of metas) {
                if (!m) continue;
                for (const mode of OSU_MODES) {
                    const set = fresh[mode].find(s => s.beatmapset_id === id);
                    if (set) { set.language = m.language; set.genre = m.genre; changed = true; }
                }
            }
            if (changed) saveOsuCollection(fresh);
            if (i + CHUNK < batch.length) await new Promise(res => setTimeout(res, PAUSE_MS));
        }
        renderOsuCollection();
    } finally {
        osuMetaBackfillRunning = false;
    }
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
        btn.innerHTML = icon('check');
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = icon('copy'); }, 1200);
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
   many-to-many with beatmaps. Carried along by the JSON export/import
   (exportOsuCollection/importOsuCollection) and by shareOsuCollectionLink/
   checkImportFromHash (see mergeIncomingCategories) so a category survives
   a move to another device either way — but still deliberately excluded
   from the public gallery publish (js/public-collections.js), since a
   category is personal organization, not something worth exposing as
   public metadata about a published collection. */
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
        `<button class="osu-tab ${c.id === osuCurrentTab ? 'active' : ''}" data-mode="${c.id}" onclick="switchOsuTab('${c.id}', this)">${icon('tag', { extraClass: 'icon-label-gap' })}${escHtml(c.name)}</button>`
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
                    <button class="osu-cat-rename" onclick="renameOsuCategory('${c.id}', event)" title="${t('osu_category_rename_title')}">${icon('pencil')}</button>
                    <button class="osu-cat-delete" onclick="deleteOsuCategory('${c.id}', event)" title="${t('osu_category_delete_title')}">${icon('trash2')}</button>
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
    // Header text/pill colors are theme-adaptive (dark text in light theme,
    // assuming the usual light page background) — but with a cover photo
    // filling the header they need to stay light-on-dark regardless of site
    // theme, or light-theme visitors get near-invisible text (see
    // .site-header.has-cover-banner in css/base.css). Only added once
    // there's actually an image, so a visitor with no collection yet still
    // gets the normal theme-correct header.
    const header = document.querySelector('.site-header');
    if (header) header.classList.add('has-cover-banner');
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

// Bumped whenever the exported shape changes in a way that matters for
// import-time compatibility decisions — not enforced as a hard gate (older
// exports with no schemaVersion at all are still accepted, see importOsuCollection),
// just carried along so a future incompatible format has something to check.
// v2: sets carry optional `language`/`genre` (osu! API v2). Purely additive —
// v1 exports import fine and get backfilled on later visits.
const OSU_EXPORT_SCHEMA_VERSION = 2;

function exportOsuCollection() {
    const data = {
        schemaVersion: OSU_EXPORT_SCHEMA_VERSION,
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

/* Drops any categoryMembers entries that reference a category id not present
   in `categories`, or a beatmapset id not present in `collection` — an
   import built by hand, from an older export, or from a partially-edited
   file could otherwise leave orphaned references that the category picker/
   tabs would silently choke on. De-dupes category ids too, keeping the
   first occurrence (a hand-edited file is the realistic way to end up with
   duplicates; a normal export never does). */
function sanitizeImportedCategoryData(collection, categories, categoryMembers) {
    const validSetIds = new Set(OSU_MODES.flatMap(m => (collection[m] || []).map(s => s.beatmapset_id)));
    const seenIds = new Set();
    const cleanCategories = categories.filter(c => {
        if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') return false;
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
    });
    const cleanMembers = {};
    for (const catId of seenIds) {
        const ids = Array.isArray(categoryMembers[catId]) ? categoryMembers[catId] : [];
        const filtered = ids.filter(id => validSetIds.has(id));
        if (filtered.length) cleanMembers[catId] = filtered;
    }
    return { categories: cleanCategories, categoryMembers: cleanMembers };
}

async function importOsuCollection(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!await verifyOsuPassword()) { event.target.value = ''; return; }

    let data;
    try {
        const text = await file.text();
        data = JSON.parse(text);
    } catch (e) {
        console.error('Import failed (not valid JSON):', e);
        alert(t('osu_import_fail_json'));
        event.target.value = '';
        return;
    }
    if (!data || typeof data !== 'object' || !data.collection || !OSU_MODES.every(m => Array.isArray(data.collection[m]))) {
        console.error('Import failed (missing/invalid collection field)');
        alert(t('osu_import_fail_format'));
        event.target.value = '';
        return;
    }

    try {
        saveOsuCollection(data.collection);
        if (Array.isArray(data.favorites)) saveOsuFavorites(data.favorites);

        const rawCategories = Array.isArray(data.categories) ? data.categories : [];
        const rawMembers = (data.categoryMembers && typeof data.categoryMembers === 'object' && !Array.isArray(data.categoryMembers))
            ? data.categoryMembers : {};
        const { categories, categoryMembers } = sanitizeImportedCategoryData(data.collection, rawCategories, rawMembers);
        saveOsuCategories(categories);
        saveOsuCategoryMembers(categoryMembers);

        renderOsuCollection();
        showShareToast(t('osu_import_done'));
    } catch (e) {
        console.error('Import failed while applying data:', e);
        alert(t('osu_import_fail'));
    } finally {
        event.target.value = '';
    }
}

/* ===== Export to osu!'s own collection.db =====
   Binary format per ppy's "Legacy database file structure" docs (also used
   by community tools like osu-db and osu!collection exporter): int32
   version, int32 collection count, then per collection an osu!-string name
   + int32 beatmap count + that many osu!-string MD5 hashes. The "osu!
   string" encoding (0x00 for empty, else 0x0b + ULEB128 byte-length + UTF-8
   bytes) is the same one used across osu!'s other binary formats (replays,
   osu!.db), not something specific to collections.
   The site's own collection only stores the trimmed API fields it actually
   renders (js/osu.js addOsuBeatmap) — never the file MD5 collection.db
   needs to identify a specific difficulty — so that has to be fetched
   per-beatmap at export time via the same get_beatmaps proxy used
   elsewhere, chunked to avoid firing hundreds of requests at once. */
function writeUleb128(bytes, value) {
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
}

function writeOsuDbString(bytes, str) {
    if (!str) { bytes.push(0x00); return; }
    const utf8 = Array.from(new TextEncoder().encode(str));
    bytes.push(0x0b);
    writeUleb128(bytes, utf8.length);
    bytes.push(...utf8);
}

function writeInt32LE(bytes, value) {
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

function buildCollectionDb(collectionsMap) {
    const bytes = [];
    writeInt32LE(bytes, 20220301); // just needs to look like a recent client version
    writeInt32LE(bytes, collectionsMap.size);
    for (const [name, hashSet] of collectionsMap) {
        writeOsuDbString(bytes, name);
        writeInt32LE(bytes, hashSet.size);
        for (const md5 of hashSet) writeOsuDbString(bytes, md5);
    }
    return new Uint8Array(bytes);
}

function readUleb128(view, offset) {
    let result = 0, shift = 0, pos = offset;
    for (;;) {
        const byte = view.getUint8(pos++);
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
    }
    return { value: result, next: pos };
}

function readOsuDbString(view, offset) {
    const marker = view.getUint8(offset);
    if (marker === 0x00) return { value: '', next: offset + 1 };
    const { value: len, next } = readUleb128(view, offset + 1);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + next, len);
    return { value: new TextDecoder('utf-8').decode(bytes), next: next + len };
}

function parseCollectionDb(buffer) {
    const view = new DataView(buffer);
    let offset = 4; // skip version
    const count = view.getInt32(offset, true); offset += 4;
    const collections = new Map();
    for (let i = 0; i < count; i++) {
        const nameRes = readOsuDbString(view, offset); offset = nameRes.next;
        const beatmapCount = view.getInt32(offset, true); offset += 4;
        const hashes = new Set();
        for (let j = 0; j < beatmapCount; j++) {
            const hashRes = readOsuDbString(view, offset); offset = hashRes.next;
            if (hashRes.value) hashes.add(hashRes.value);
        }
        collections.set(nameRes.value, hashes);
    }
    return collections;
}

function openCollectionDbModal() {
    const status = document.getElementById('collection-db-status');
    status.innerText = '';
    status.style.color = '';
    document.getElementById('collection-db-merge-input').value = '';
    document.getElementById('collection-io-import-input').value = '';
    document.getElementById('collection-db-modal').style.display = 'flex';
}
function closeCollectionDbModal() {
    document.getElementById('collection-db-modal').style.display = 'none';
}

async function exportOsuCollectionDb() {
    const status = document.getElementById('collection-db-status');
    const col = getOsuCollection();
    const allSets = OSU_MODES.flatMap(m => col[m]);
    if (allSets.length === 0) {
        status.innerText = t('collection_db_empty');
        status.style.color = '#ff5252';
        return;
    }

    const setById = new Map(allSets.map(s => [s.beatmapset_id, s]));
    const allBeatmapIds = [...new Set(allSets.flatMap(s => s.beatmaps.map(b => b.beatmap_id)))];
    const md5Map = {};
    const CHUNK = 10;

    status.style.color = '#c8a2e0';
    for (let i = 0; i < allBeatmapIds.length; i += CHUNK) {
        status.innerText = t('collection_db_fetching', { done: i, total: allBeatmapIds.length });
        const chunk = allBeatmapIds.slice(i, i + CHUNK);
        const results = await Promise.all(chunk.map(id => osuFetch(`b=${id}`).catch(() => null)));
        results.forEach((r, idx) => {
            const bm = r && r[0];
            if (bm && bm.file_md5) md5Map[chunk[idx]] = bm.file_md5;
        });
    }

    const generated = new Map();
    const addToCollection = (name, beatmapsetIds) => {
        if (!name) return;
        if (!generated.has(name)) generated.set(name, new Set());
        const bucket = generated.get(name);
        beatmapsetIds.forEach(setId => {
            const set = setById.get(setId);
            if (!set) return;
            set.beatmaps.forEach(b => { if (md5Map[b.beatmap_id]) bucket.add(md5Map[b.beatmap_id]); });
        });
    };

    getOsuCategories().forEach(c => {
        const members = getOsuCategoryMembers()[c.id] || [];
        if (members.length) addToCollection(c.name, members);
    });
    const favorites = getOsuFavorites();
    if (favorites.length) addToCollection(t('osu_fav'), favorites);
    if (generated.size === 0) addToCollection(t('collection_db_all_name'), allSets.map(s => s.beatmapset_id));

    let finalMap = generated;
    const mergeFile = document.getElementById('collection-db-merge-input').files[0];
    if (mergeFile) {
        try {
            const existing = parseCollectionDb(await mergeFile.arrayBuffer());
            for (const [name, hashes] of generated) existing.set(name, hashes);
            finalMap = existing;
        } catch (e) {
            console.error('Failed to parse uploaded collection.db, exporting without merge:', e);
        }
    }

    const bytes = buildCollectionDb(finalMap);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'collection.db';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    status.innerText = t('collection_db_done');
    status.style.color = '#34d399';
}

/* ===== .osdb (Collection Manager / osu!Stats format) =====
   Piotrekol's Collection Manager format. Unlike collection.db it stores the
   beatmap + beatmapset ids (plus metadata), so Collection Manager can match
   it in-game *without* the per-difficulty MD5 that collection.db needs — and
   it's the usual way whole collections get shared. Field order below is from
   Collection Manager's OsdbCollectionHandler, "o!dm8" (full) variant.

   NOTE: .osdb strings are plain .NET BinaryWriter strings — a 7-bit
   (ULEB128) byte length then UTF-8, 0x00 for an empty string — NOT the
   0x0b-prefixed "osu! string" writeOsuDbString() uses. From o!dm7 on,
   everything after the leading version string is gzipped (fflate). */
const OSDB_VERSIONS = { 'o!dm': 1, 'o!dm2': 2, 'o!dm3': 3, 'o!dm4': 4, 'o!dm5': 5, 'o!dm6': 6, 'o!dm7': 7, 'o!dm8': 8, 'o!dm7min': 1007, 'o!dm8min': 1008 };
const OSDB_WRITE_VERSION = 'o!dm8';

function writeNetString(bytes, str) {
    const utf8 = str ? new TextEncoder().encode(str) : new Uint8Array(0);
    writeUleb128(bytes, utf8.length);
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8[i]);
}
function readNetString(view, offset) {
    const { value: len, next } = readUleb128(view, offset);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + next, len);
    return { value: new TextDecoder('utf-8').decode(bytes), next: next + len };
}
function writeFloat64LE(bytes, value) {
    const u8 = new Uint8Array(8);
    new DataView(u8.buffer).setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) bytes.push(u8[i]);
}
function triggerBytesDownload(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* collections: [{ name, onlineId?, beatmaps: [{ mapId, mapSetId, artist, title, diff, md5, mode, stars }] }] */
function buildOsdb(collections, editor) {
    const p = [];
    writeNetString(p, OSDB_WRITE_VERSION);
    writeFloat64LE(p, Date.now() / 86400000 + 25569); // OLE Automation date (days since 1899-12-30)
    writeNetString(p, editor || 'osu! collection');
    writeInt32LE(p, collections.length);
    for (const c of collections) {
        writeNetString(p, c.name || '');
        writeInt32LE(p, Number.isInteger(c.onlineId) ? c.onlineId : -1);
        const maps = c.beatmaps || [];
        writeInt32LE(p, maps.length);
        for (const m of maps) {
            writeInt32LE(p, m.mapId || 0);
            writeInt32LE(p, m.mapSetId || 0);
            writeNetString(p, m.artist || '');
            writeNetString(p, m.title || '');
            writeNetString(p, m.diff || '');
            writeNetString(p, m.md5 || '');
            writeNetString(p, '');               // user comment
            p.push((m.mode || 0) & 0xff);        // play mode
            writeFloat64LE(p, m.stars || 0);     // star rating
        }
        writeInt32LE(p, 0);                      // hash-only beatmap count
    }
    writeNetString(p, 'By Piotrekol');

    const gz = fflate.gzipSync(new Uint8Array(p));
    const head = [];
    writeNetString(head, OSDB_WRITE_VERSION);    // uncompressed leading version string
    const out = new Uint8Array(head.length + gz.length);
    out.set(head, 0);
    out.set(gz, head.length);
    return out;
}

/* -> [{ name, beatmaps: [{ mapId, mapSetId, mode }] }] (metadata/md5 are read past but dropped) */
function parseOsdb(buffer) {
    let view = new DataView(buffer);
    const head = readNetString(view, 0);
    const versionString = head.value;
    const fileVersion = OSDB_VERSIONS[versionString];
    if (!fileVersion) throw new Error('OSDB_BAD_VERSION:' + versionString);

    let cur;
    if (fileVersion >= 7) {
        const inflated = fflate.gunzipSync(new Uint8Array(buffer, head.next));
        view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
        cur = readNetString(view, 0).next;      // skip inner version string
    } else {
        cur = head.next;
    }

    const isMin = versionString.endsWith('min');
    const isFull = !isMin;
    cur += 8;                                    // save date (f64)
    cur = readNetString(view, cur).next;         // editor
    const count = view.getInt32(cur, true); cur += 4;

    const collections = [];
    for (let i = 0; i < count; i++) {
        const nameRes = readNetString(view, cur); cur = nameRes.next;
        if (fileVersion >= 7) cur += 4;          // online id
        const nBeatmaps = view.getInt32(cur, true); cur += 4;
        const beatmaps = [];
        for (let j = 0; j < nBeatmaps; j++) {
            const mapId = view.getInt32(cur, true); cur += 4;
            let mapSetId = 0;
            if (fileVersion >= 2) { mapSetId = view.getInt32(cur, true); cur += 4; }
            if (!isMin) {
                cur = readNetString(view, cur).next; // artist
                cur = readNetString(view, cur).next; // title
                cur = readNetString(view, cur).next; // diff
            }
            cur = readNetString(view, cur).next;     // md5
            if (fileVersion >= 4) cur = readNetString(view, cur).next; // user comment
            let mode = 0;
            if (fileVersion >= 8 || (fileVersion >= 5 && isFull)) { mode = view.getUint8(cur); cur += 1; }
            if (fileVersion >= 8 || (fileVersion >= 6 && isFull)) cur += 8; // star rating (f64)
            beatmaps.push({ mapId, mapSetId, mode });
        }
        if (fileVersion >= 3) {
            const nHashes = view.getInt32(cur, true); cur += 4;
            for (let j = 0; j < nHashes; j++) cur = readNetString(view, cur).next;
        }
        collections.push({ name: nameRes.value, beatmaps });
    }
    return collections;
}

/* Export the collection as an .osdb (Collection Manager / osu!Stats). Unlike
   the collection.db export this needs no network calls — .osdb carries the
   ids the site already has. One .osdb collection per category (+ Favorites),
   or a single "osu!收藏" collection if there are no categories. */
function exportOsuOsdb() {
    const status = document.getElementById('collection-db-status');
    const col = getOsuCollection();
    const allSets = OSU_MODES.flatMap(m => col[m]);
    if (allSets.length === 0) {
        if (status) { status.innerText = t('collection_db_empty'); status.style.color = '#ff5252'; }
        return;
    }
    const setById = new Map(allSets.map(s => [s.beatmapset_id, s]));

    const osdbCollections = [];
    const addColl = (name, setIds) => {
        const beatmaps = [];
        setIds.forEach(id => {
            const set = setById.get(id);
            if (!set) return;
            (set.beatmaps || []).forEach(b => beatmaps.push({
                mapId: b.beatmap_id || 0,
                mapSetId: set.beatmapset_id,
                artist: set.artist || '',
                title: set.title || '',
                diff: b.version || '',
                md5: '',
                mode: Number.isInteger(b.mode_int) ? b.mode_int : (set.mode || 0),
                stars: b.difficulty_rating || 0,
            }));
        });
        if (beatmaps.length) osdbCollections.push({ name, beatmaps });
    };

    const members = getOsuCategoryMembers();
    getOsuCategories().forEach(c => { if ((members[c.id] || []).length) addColl(c.name, members[c.id]); });
    const favorites = getOsuFavorites();
    if (favorites.length) addColl(t('osu_fav'), favorites);
    if (osdbCollections.length === 0) addColl(t('collection_db_all_name'), allSets.map(s => s.beatmapset_id));

    const editor = (getLoggedInOsuUser && getLoggedInOsuUser() && getLoggedInOsuUser().username) || 'osu! collection';
    triggerBytesDownload(buildOsdb(osdbCollections, editor), 'osu!collection.osdb');
    if (status) { status.innerText = t('collection_io_osdb_done'); status.style.color = '#34d399'; }
}

/* Import an in-game collection.db OR a shared/osu!Stats .osdb onto the site.
   Never destructive — only adds sets you don't already have, and merges into
   a same-named category (creating it if missing). collection.db entries are
   MD5 hashes so they need a lookup pass (h=<md5> via the osu proxy); .osdb
   carries beatmapset ids directly and skips straight to the set fetch. */
async function importOsuGameCollection(event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;
    if (!await verifyOsuPassword()) { fileInput.value = ''; return; }

    const status = document.getElementById('collection-db-status');
    const setStatus = (msg, color) => { if (status) { status.innerText = msg; status.style.color = color || '#c8a2e0'; } };

    try {
        const buffer = await file.arrayBuffer();
        const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)));
        const isOsdb = magic.startsWith('o!dm') || file.name.toLowerCase().endsWith('.osdb');

        let named = [];      // [{ name, entries: [{ setId, mode }] }]
        let unresolved = 0;

        if (isOsdb) {
            let parsed;
            try {
                parsed = parseOsdb(buffer);
            } catch (e) {
                if (String(e.message).startsWith('OSDB_BAD_VERSION')) { setStatus(t('collection_io_osdb_unsupported'), '#ff5252'); fileInput.value = ''; return; }
                throw e;
            }
            named = parsed.map(c => ({
                name: c.name,
                entries: c.beatmaps.filter(b => b.mapSetId > 0).map(b => ({ setId: b.mapSetId, mode: b.mode })),
            }));
        } else {
            let dbMap;
            try { dbMap = parseCollectionDb(buffer); }
            catch (e) { setStatus(t('collection_io_bad_file'), '#ff5252'); fileInput.value = ''; return; }

            const allHashes = [...new Set([...dbMap.values()].flatMap(s => [...s]))];
            const hashToSet = {};
            const HCHUNK = 10;
            for (let i = 0; i < allHashes.length; i += HCHUNK) {
                setStatus(t('collection_db_fetching', { done: i, total: allHashes.length }));
                const chunk = allHashes.slice(i, i + HCHUNK);
                const results = await Promise.all(chunk.map(h => osuFetch(`h=${h}`).catch(() => null)));
                results.forEach((r, idx) => {
                    const bm = r && r[0];
                    if (bm && bm.beatmapset_id) hashToSet[chunk[idx]] = { setId: parseInt(bm.beatmapset_id), mode: parseInt(bm.mode) };
                });
            }
            named = [...dbMap.entries()].map(([name, hashes]) => {
                const entries = [];
                hashes.forEach(h => { if (hashToSet[h]) entries.push(hashToSet[h]); else unresolved++; });
                return { name, entries };
            });
        }

        const report = await applyImportedCollections(named, msg => setStatus(msg));
        report.unresolved += unresolved;
        const doneMsg = t('collection_io_import_done', { sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved });
        setStatus(doneMsg, '#34d399');
        if (typeof showShareToast === 'function') showShareToast(doneMsg);
    } catch (e) {
        console.error('Game collection import failed:', e);
        setStatus(t('collection_io_bad_file'), '#ff5252');
    } finally {
        fileInput.value = '';
    }
}

/* Shared tail of every "bring a list of collections in" flow (game file
   import, osu! profile import): given [{ name, entries: [{ setId }] }], fetch
   each set the collection doesn't already have (via the v1 s= proxy, chunked)
   into the standard setInfo shape, then merge each source list into a
   same-named category — creating it if missing, never overwriting. Returns
   { addedSets, touchedCats, unresolved }. onProgress(msg) is optional. */
async function applyImportedCollections(named, onProgress) {
    const report = { addedSets: 0, touchedCats: 0, unresolved: 0 };
    const col = getOsuCollection();
    const haveSetIds = new Set(OSU_MODES.flatMap(m => col[m].map(s => s.beatmapset_id)));
    const wantedSetIds = [...new Set(named.flatMap(c => c.entries.map(e => e.setId)))].filter(id => !haveSetIds.has(id));

    const SCHUNK = 6;
    for (let i = 0; i < wantedSetIds.length; i += SCHUNK) {
        if (onProgress) onProgress(t('collection_io_importing', { done: i, total: wantedSetIds.length }));
        const chunk = wantedSetIds.slice(i, i + SCHUNK);
        const results = await Promise.all(chunk.map(id => osuFetch(`s=${id}`).catch(() => null)));
        for (const beatmaps of results) {
            if (!beatmaps || beatmaps.length === 0) { report.unresolved++; continue; }
            const modeNum = parseInt(beatmaps[0].mode);
            const modeKey = OSU_MODE_NAMES[modeNum];
            const setId = parseInt(beatmaps[0].beatmapset_id);
            if (!modeKey || haveSetIds.has(setId)) continue;
            const setInfo = {
                beatmapset_id: setId,
                title: beatmaps[0].title,
                artist: beatmaps[0].artist,
                creator: beatmaps[0].creator,
                mode: modeNum,
                addedAt: new Date().toISOString(),
                beatmaps: beatmaps.map(b => ({
                    beatmap_id: parseInt(b.beatmap_id),
                    version: b.version,
                    difficulty_rating: parseFloat(b.difficultyrating),
                    hit_length: parseInt(b.hit_length),
                    total_length: parseInt(b.total_length),
                    bpm: parseFloat(b.bpm),
                    key_count: parseFloat(b.diff_size),
                    mode_int: parseInt(b.mode),
                })).sort((a, b) => a.difficulty_rating - b.difficulty_rating),
            };
            const meta = await fetchOsuSetMeta(setId).catch(() => null);
            if (meta) { setInfo.language = meta.language; setInfo.genre = meta.genre; }
            col[modeKey].push(setInfo);
            haveSetIds.add(setId);
            report.addedSets++;
        }
        saveOsuCollection(col);
    }

    const cats = getOsuCategories();
    const catMembers = getOsuCategoryMembers();
    const validSetIds = new Set(OSU_MODES.flatMap(m => col[m].map(s => s.beatmapset_id)));
    for (const c of named) {
        const name = (c.name || '').trim();
        const ids = [...new Set(c.entries.map(e => e.setId))].filter(id => validSetIds.has(id));
        if (!name || ids.length === 0) continue;
        let cat = cats.find(x => x.name === name);
        if (!cat) { cat = { id: crypto.randomUUID(), name }; cats.push(cat); }
        catMembers[cat.id] = [...new Set([...(catMembers[cat.id] || []), ...ids])];
        report.touchedCats++;
    }
    saveOsuCategories(cats);
    saveOsuCategoryMembers(catMembers);

    renderOsuCollection();
    return report;
}

/* Page through a logged-in visitor's osu! profile beatmapsets (favourite or
   most_played) via the v2 proxy, newest/most-played first, capped. */
async function fetchOsuProfileBeatmapsets(userId, type, cap) {
    const out = [];
    const PAGE = Math.min(100, cap);
    for (let offset = 0; out.length < cap; offset += PAGE) {
        let batch;
        try {
            const r = await fetch(`/.netlify/functions/osu-user-beatmapsets?id=${userId}&type=${type}&limit=${PAGE}&offset=${offset}`);
            if (!r.ok) break;
            batch = await r.json();
        } catch { break; }
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const x of batch) { if (x && x.beatmapset_id) out.push(parseInt(x.beatmapset_id)); }
        if (batch.length < PAGE) break;
    }
    return [...new Set(out)].slice(0, cap);
}

/* Seed the collection from the logged-in visitor's osu! profile — all their
   favourite beatmapsets + their top 50 most-played — into "Favourites" and
   "Most played" categories. Offered once on first login when the collection
   is empty (checkOsuLoginFromUrl), and available any time from the toolbar
   button. Non-destructive, same as every other import. */
async function importFromOsuProfile() {
    if (!await verifyOsuPassword()) return;
    const user = getLoggedInOsuUser();
    if (!user || !user.id) { showShareToast(t('osu_profile_need_login')); return; }

    showShareToast(t('osu_profile_importing', { done: 0, total: '…' }));
    let favIds, mpIds;
    try {
        favIds = await fetchOsuProfileBeatmapsets(user.id, 'favourite', 300);
        mpIds = await fetchOsuProfileBeatmapsets(user.id, 'most_played', 50);
    } catch (e) {
        console.error('osu! profile beatmapset fetch failed:', e);
        showShareToast(t('osu_profile_import_fail'));
        return;
    }

    const named = [];
    if (favIds.length) named.push({ name: t('osu_profile_cat_favourites'), entries: favIds.map(id => ({ setId: id })) });
    if (mpIds.length) named.push({ name: t('osu_profile_cat_mostplayed'), entries: mpIds.map(id => ({ setId: id })) });
    if (named.length === 0) { showShareToast(t('osu_profile_import_empty')); return; }

    const report = await applyImportedCollections(named, msg => showShareToast(msg));
    showShareToast(t('collection_io_import_done', { sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved }));
}

/* ===== Collection tools modal — generate categories from your osu! account,
   and a health check for the collection ===== */
function openCollectionToolsModal() {
    const gs = document.getElementById('ctools-gen-status');
    gs.innerText = ''; gs.style.color = '';
    document.getElementById('ctools-health-results').innerHTML = '';
    document.getElementById('ctools-mapper-input').value = '';
    document.getElementById('collection-tools-modal').style.display = 'flex';
}
function closeCollectionToolsModal() {
    document.getElementById('collection-tools-modal').style.display = 'none';
}

/* type: 'favourite' | 'most_played' | 'best' | 'recent' — turns a slice of
   the logged-in visitor's osu! account into one merged category, reusing
   applyImportedCollections (so nothing already collected is touched). */
async function generateCollectionFor(type) {
    if (!await verifyOsuPassword()) return;
    const user = getLoggedInOsuUser();
    const status = document.getElementById('ctools-gen-status');
    const setS = (m, c) => { status.innerText = m; status.style.color = c || '#c8a2e0'; };
    if (!user || !user.id) { setS(t('osu_profile_need_login'), '#ff5252'); return; }

    setS(t('osu_profile_importing', { done: 0, total: '…' }));
    let setIds = [];
    let name = '';
    try {
        if (type === 'favourite') {
            setIds = await fetchOsuProfileBeatmapsets(user.id, 'favourite', 300);
            name = t('osu_profile_cat_favourites');
        } else if (type === 'most_played') {
            setIds = await fetchOsuProfileBeatmapsets(user.id, 'most_played', 50);
            name = t('osu_profile_cat_mostplayed');
        } else if (type === 'best' || type === 'recent') {
            const plays = await osuFetch(`${type}=${user.id}&limit=${type === 'best' ? 100 : 50}`);
            const bmIds = [...new Set((plays || []).map(p => p.beatmap_id).filter(Boolean))];
            const sids = new Set();
            const CH = 10;
            for (let i = 0; i < bmIds.length; i += CH) {
                setS(t('osu_profile_importing', { done: i, total: bmIds.length }));
                const chunk = bmIds.slice(i, i + CH);
                const rs = await Promise.all(chunk.map(id => osuFetch(`b=${id}`).catch(() => null)));
                rs.forEach(r => { const b = r && r[0]; if (b && b.beatmapset_id) sids.add(parseInt(b.beatmapset_id)); });
            }
            setIds = [...sids];
            name = type === 'best' ? t('ctools_cat_best') : t('ctools_cat_recent');
        }
    } catch (e) {
        console.error('generateCollectionFor failed:', e);
        setS(t('osu_profile_import_fail'), '#ff5252');
        return;
    }
    if (!setIds.length) { setS(t('osu_profile_import_empty'), '#f59e0b'); return; }

    const report = await applyImportedCollections([{ name, entries: setIds.map(id => ({ setId: id })) }], m => setS(m));
    setS(t('collection_io_import_done', { sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved }), '#34d399');
}

/* All of a mapper's ranked/approved/loved sets (graveyard/pending skipped),
   capped, into a "Mapper: <name>" category. */
async function generateCollectionFromMapper() {
    if (!await verifyOsuPassword()) return;
    const status = document.getElementById('ctools-gen-status');
    const setS = (m, c) => { status.innerText = m; status.style.color = c || '#c8a2e0'; };
    const raw = document.getElementById('ctools-mapper-input').value.trim();
    if (!raw) return;

    setS(t('osu_profile_importing', { done: 0, total: '…' }));
    let rows;
    try {
        const isId = /^\d+$/.test(raw);
        rows = await osuFetch(`mapper=${encodeURIComponent(raw)}${isId ? '' : '&mapper_type=string'}`);
    } catch (e) {
        console.error('mapper lookup failed:', e);
        setS(t('osu_profile_import_fail'), '#ff5252');
        return;
    }
    if (!Array.isArray(rows) || rows.length === 0) { setS(t('ctools_mapper_none'), '#f59e0b'); return; }

    const RANKED = new Set(['1', '2', '4']); // ranked / approved / loved
    const setIds = [...new Set(rows.filter(r => RANKED.has(String(r.approved))).map(r => parseInt(r.beatmapset_id)))].slice(0, 80);
    if (!setIds.length) { setS(t('ctools_mapper_none'), '#f59e0b'); return; }

    const creator = rows[0].creator || raw;
    const report = await applyImportedCollections(
        [{ name: t('ctools_cat_mapper', { name: creator }), entries: setIds.map(id => ({ setId: id })) }],
        m => setS(m),
    );
    setS(t('collection_io_import_done', { sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved }), '#34d399');
}

/* ===== 🎯 Practice-collection generators =====
   Turn the visitor's own osu! results into a collection they can play
   against — the wedge this site has over osu!Collector / CollectionManager,
   which have no notion of your scores. See
   docs/practice-collection-generator-spec.md.

   MVP = two farm-dataset-backed kinds, standard mode only:
   - 'push' 突破分  : farm maps whose FC pp would break into your top 100
   - 'goal' 目標圖池 : farm maps each worth >= the single-score pp you still
                       need for the target total typed in the PP panel
   Both are 5.5*+ only (the farm crawler's STAR_FLOOR); lower brackets get
   blocked with an honest message and are the job of the score-driven kinds
   (低準度 / 相似圖 / 弱項) planned for later. */

const PRACTICE_N_MIN = 40;
const PRACTICE_N_MAX = 60;
const PRACTICE_MODE = 0;                 // MVP: standard only
const PRACTICE_MODE_NAME = 'osu';        // farm-maps-list `mode` param
const PRACTICE_GOOD_ACC = 95;            // a top-100 play at >= this acc counts as "already done"

function practiceMedian(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function practicePercentile(nums, p) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

/* get_user_best has pp but no star rating and no set id, so this batches
   get_beatmap (b=) in chunks the same way generateCollectionFor('best')
   does. Returns the pp/star summary both kinds need, plus the beatmap_ids
   the user has already scored well on (so we don't recommend those back). */
async function practiceFetchTopPlays(uid, mode, onProgress) {
    const scores = await osuFetch(`best=${uid}&limit=100&m=${mode}`) || [];
    if (!scores.length) return null;
    const ppList = scores.map(s => parseFloat(s.pp)).filter(Number.isFinite).sort((a, b) => b - a);

    const starByBeatmap = new Map();
    const bmIds = [...new Set(scores.map(s => s.beatmap_id).filter(Boolean))];
    const CH = 10;
    for (let i = 0; i < bmIds.length; i += CH) {
        if (onProgress) onProgress(t('practice_reading_top', { done: i, total: bmIds.length }));
        const chunk = bmIds.slice(i, i + CH);
        const rs = await Promise.all(chunk.map(id => osuFetch(`b=${id}`).catch(() => null)));
        rs.forEach((r, j) => {
            const b = r && r[0];
            if (b) starByBeatmap.set(chunk[j], parseFloat(b.difficultyrating));
        });
    }
    const stars = [...starByBeatmap.values()].filter(Number.isFinite);

    const goodScoreBeatmapIds = new Set(
        scores.filter(s => parseFloat(calcOsuAccuracy(s, mode)) >= PRACTICE_GOOD_ACC)
              .map(s => parseInt(s.beatmap_id)),
    );

    return {
        ppList,
        p100: ppList.length ? ppList[Math.min(99, ppList.length - 1)] : 0,
        starMedian: practiceMedian(stars),
        star90: practicePercentile(stars, 90),
        goodScoreBeatmapIds,
    };
}

/* Page farm-maps-list within a pp/star band, collecting up to `want` rows.
   `total` and `coverage` come from page 0 so the caller can run the
   coverage gate before committing to the rest of the pages. */
async function practiceCollectFarmBand(band, want, onProgress) {
    const qs = new URLSearchParams({
        mode: PRACTICE_MODE_NAME,
        mods: band.mods,
        // No farmOnly: that flag keeps only the ~700 maps the crawler tags as
        // active DT-abuse farm, which is far too narrow to fill a pp/star
        // band. "Break into your top 100" just needs any ranked 5.5*+ map in
        // range you haven't done — the whole computed dataset (~70k) is fair
        // game. (A "prefer farm maps" toggle could come back later.)
        ppMin: band.ppMin.toFixed(1),
        ppMax: band.ppMax.toFixed(1),
        starMin: band.starMin.toFixed(2),
        starMax: band.starMax.toFixed(2),
        sort: band.sort,
    });
    const get = (page) => fetch(`/.netlify/functions/farm-maps-list?${qs}&page=${page}`).then(r => r.json());

    const first = await get(0);
    const total = first.total || 0;
    const coverage = first.coverage || {};
    const items = [...(first.items || [])];
    const pageSize = first.pageSize || 20;
    const pages = Math.ceil(total / pageSize);
    for (let p = 1; p < pages && items.length < want; p++) {
        if (onProgress) onProgress(t('practice_scanning_farm', { done: items.length, total: Math.min(total, want) }));
        const res = await get(p);
        items.push(...(res.items || []));
    }
    return { items, total, coverage };
}

/* Gate: not enough maps in this pp/star band to build a real collection.
   `coverage.totalKnown` turned out to be a stale/capped field so the old
   ratio check was meaningless — the honest signal is just how many rows the
   band actually matched. */
function practiceCoverageBlocked(total) {
    return total < PRACTICE_N_MIN;
}

function practiceExistingSetIds() {
    const col = getOsuCollection();
    return new Set(OSU_MODES.flatMap(m => col[m].map(s => s.beatmapset_id)));
}

function practiceCatName(kind, opts = {}) {
    if (kind === 'goal') return t('practice_cat_goal', { target: Math.round(opts.target).toLocaleString() });
    return t('practice_cat_push');
}

async function generatePracticeCollection(kind) {
    if (!await verifyOsuPassword()) return;
    const status = document.getElementById('ctools-practice-status');
    const setS = (m, c) => { status.innerText = m; status.style.color = c || '#c8a2e0'; };
    const user = getLoggedInOsuUser();
    if (!user || !user.id) { setS(t('osu_profile_need_login'), '#ff5252'); return; }

    const mods = (document.getElementById('ctools-practice-mods') || {}).value || 'NM';

    // 目標圖池 needs the target from the PP panel before any fetching
    let target = null;
    if (kind === 'goal') {
        target = parseFloat((document.getElementById('pp-goal-target') || {}).value);
        if (!Number.isFinite(target) || target <= 0) { setS(t('practice_goal_need_target'), '#f59e0b'); return; }
    }

    setS(t('practice_reading_top', { done: 0, total: '…' }));
    let top;
    try {
        top = await practiceFetchTopPlays(user.id, PRACTICE_MODE, setS);
    } catch (e) {
        console.error('practice: top plays fetch failed:', e);
        setS(t('osu_profile_import_fail'), '#ff5252');
        return;
    }
    if (!top || top.ppList.length < 10) { setS(t('practice_need_more_plays'), '#f59e0b'); return; }

    let band;
    if (kind === 'push') {
        band = {
            mods,
            ppMin: top.p100,
            ppMax: top.p100 * 1.3,
            starMin: Math.max(0, top.starMedian - 0.7),
            starMax: top.starMedian + 0.7,
            sort: 'pp_desc',
        };
    } else {
        // Recompute `needed` against the LOGGED-IN user's own top 100 (the PP
        // panel's own calc runs against whatever profile was last looked up).
        let actualTotal = 0;
        try {
            const me = await osuFetch(`u=${user.id}&m=${PRACTICE_MODE}`);
            if (me && me[0] && me[0].pp_raw != null) actualTotal = parseFloat(me[0].pp_raw);
        } catch { /* fall through with 0 → needed is just larger */ }
        if (actualTotal && actualTotal >= target) { setS(t('practice_goal_reached'), '#34d399'); return; }
        const bonusPp = Math.max(0, actualTotal - weightedPpSum(top.ppList));
        const needed = ppNeededForTarget(top.ppList, bonusPp, target);
        const starMax = top.star90 + 0.3;
        band = {
            mods,
            ppMin: needed * 0.9,
            ppMax: needed * 1.6,
            starMin: Math.max(0, starMax - 1.5),
            starMax,
            sort: 'star_asc',
        };
    }

    setS(t('practice_scanning_farm', { done: 0, total: PRACTICE_N_MAX }));
    let farm;
    try {
        farm = await practiceCollectFarmBand(band, PRACTICE_N_MAX * 3, setS);
    } catch (e) {
        console.error('practice: farm-maps-list failed:', e);
        setS(t('osu_profile_import_fail'), '#ff5252');
        return;
    }
    if (practiceCoverageBlocked(farm.total)) { setS(t('practice_low_coverage'), '#f59e0b'); return; }

    const have = practiceExistingSetIds();
    const seenSet = new Set();
    const entries = [];
    for (const r of farm.items) {
        const sid = parseInt(r.beatmapset_id);
        if (!sid || have.has(sid) || seenSet.has(sid)) continue;
        if (top.goodScoreBeatmapIds.has(parseInt(r.beatmap_id))) continue;
        seenSet.add(sid);
        entries.push({ setId: sid });
        if (entries.length >= PRACTICE_N_MAX) break;
    }
    if (entries.length < PRACTICE_N_MIN) { setS(t('practice_low_coverage'), '#f59e0b'); return; }

    const report = await applyImportedCollections(
        [{ name: practiceCatName(kind, { target }), entries }],
        m => setS(m),
    );
    setS(t('collection_io_import_done', {
        sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved,
    }), '#34d399');
}

/* Remove several sets at once, cleaning their category memberships too
   (removeOsuSet only touches the mode arrays). */
async function removeOsuSetsByIds(ids) {
    if (!ids.length || !await verifyOsuPassword()) return;
    const drop = new Set(ids);
    const col = getOsuCollection();
    OSU_MODES.forEach(m => { col[m] = col[m].filter(s => !drop.has(s.beatmapset_id)); });
    saveOsuCollection(col);
    const members = getOsuCategoryMembers();
    for (const k of Object.keys(members)) members[k] = (members[k] || []).filter(id => !drop.has(id));
    saveOsuCategoryMembers(members);
    saveOsuFavorites(getOsuFavorites().filter(id => !drop.has(id)));
    renderOsuCollection();
}

/* Keep the first occurrence of each beatmapset_id (scanning standard→mania),
   drop the rest. */
async function dedupeOsuCollection() {
    if (!await verifyOsuPassword()) return;
    const col = getOsuCollection();
    const seen = new Set();
    let removed = 0;
    for (const m of OSU_MODES) {
        col[m] = col[m].filter(s => {
            if (seen.has(s.beatmapset_id)) { removed++; return false; }
            seen.add(s.beatmapset_id);
            return true;
        });
    }
    saveOsuCollection(col);
    renderOsuCollection();
    const status = document.getElementById('ctools-gen-status');
    if (status) { status.innerText = t('ctools_dedupe_done', { n: removed }); status.style.color = '#34d399'; }
    runCollectionHealthCheck();
}

/* Scans the collection: duplicate set ids (client-side), then a bounded
   re-fetch pass flagging sets that no longer exist on osu!, are no longer
   ranked/approved/loved, or whose difficulty count has changed. */
async function runCollectionHealthCheck() {
    if (!await verifyOsuPassword()) return;
    const out = document.getElementById('ctools-health-results');
    const col = getOsuCollection();
    const allSets = OSU_MODES.flatMap(m => col[m]);
    if (!allSets.length) { out.innerHTML = `<p class="status">${escHtml(t('collection_db_empty'))}</p>`; return; }

    const seen = new Set();
    const dupIds = new Set();
    for (const s of allSets) {
        if (seen.has(s.beatmapset_id)) dupIds.add(s.beatmapset_id);
        else seen.add(s.beatmapset_id);
    }
    const storedById = new Map(allSets.map(s => [s.beatmapset_id, s]));
    const ids = [...seen];

    out.innerHTML = `<p class="status" style="color:#c8a2e0" id="ctools-health-progress"></p>`;
    const prog = document.getElementById('ctools-health-progress');
    const dead = [], nonRanked = [], diffChanged = [];
    const CH = 6;
    for (let i = 0; i < ids.length; i += CH) {
        if (prog) prog.textContent = t('ctools_health_scanning', { done: i, total: ids.length });
        const chunk = ids.slice(i, i + CH);
        const rs = await Promise.all(chunk.map(id => osuFetch(`s=${id}`).catch(() => null)));
        rs.forEach((r, k) => {
            const id = chunk[k];
            const stored = storedById.get(id);
            if (!r || r.length === 0) { dead.push(id); return; }
            if (!['1', '2', '4'].includes(String(r[0].approved))) nonRanked.push(id);
            if (stored && stored.beatmaps && r.length !== stored.beatmaps.length) diffChanged.push(id);
        });
    }

    const dupArr = [...dupIds];
    const rows = [];
    const line = (labelKey, arr, action) => {
        if (!arr.length) return;
        rows.push(`<div class="ctools-health-row">
            <span>${escHtml(t(labelKey, { n: arr.length }))}</span>
            ${action || ''}
        </div>`);
    };
    line('ctools_health_dupes', dupArr,
        dupArr.length ? `<button class="btn btn-sm" onclick="dedupeOsuCollection()">${escHtml(t('ctools_health_dedupe_btn'))}</button>` : '');
    line('ctools_health_dead', dead,
        dead.length ? `<button class="btn btn-sm" onclick="removeOsuSetsByIds([${dead.join(',')}]).then(runCollectionHealthCheck)">${escHtml(t('ctools_health_remove_btn'))}</button>` : '');
    line('ctools_health_diffchanged', diffChanged,
        diffChanged.length ? `<button class="btn btn-sm" onclick="refreshAllOsuSets().then(runCollectionHealthCheck)">${escHtml(t('ctools_health_refresh_btn'))}</button>` : '');
    line('ctools_health_nonranked', nonRanked, '');

    out.innerHTML = rows.length
        ? rows.join('')
        : `<p class="status" style="color:#34d399">${escHtml(t('ctools_health_ok'))}</p>`;
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
        // Categories/categoryMembers ride along too now (previously
        // share-link-only synced the raw collection, so a beatmap crossing
        // devices this way would silently lose which category/tab it was
        // filed under — the JSON file export/import already carried these,
        // this just brings the share-link path to parity with it).
        const encoded = await compressToBase64Url({
            collection: col,
            categories: getOsuCategories(),
            categoryMembers: getOsuCategoryMembers(),
        });
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

/* Merges incoming categories into the visitor's own, matching by name
   (category ids are per-device crypto.randomUUID()s — see
   addOsuCategoryFromModal — so two devices' categories never share an id
   even when they're "the same" category by the user's own reckoning,
   making name the only sensible merge key). A name match reuses the local
   id and unions its members; an unmatched incoming category is created
   locally with a fresh id. Members are filtered to beatmapset ids that
   actually exist in the (already-merged) local collection, same defensive
   reasoning as sanitizeImportedCategoryData for the file-import path. */
function mergeIncomingCategories(incomingCategories, incomingCategoryMembers) {
    if (!Array.isArray(incomingCategories) || incomingCategories.length === 0) return 0;
    const col = getOsuCollection();
    const validSetIds = new Set(OSU_MODES.flatMap(m => col[m].map(s => s.beatmapset_id)));

    const localCategories = getOsuCategories();
    const localMembers = getOsuCategoryMembers();
    const nameToLocalId = new Map(localCategories.map(c => [c.name, c.id]));
    let touched = 0;

    for (const inCat of incomingCategories) {
        if (!inCat || typeof inCat.id !== 'string' || typeof inCat.name !== 'string') continue;
        let localId = nameToLocalId.get(inCat.name);
        if (!localId) {
            localId = crypto.randomUUID();
            localCategories.push({ id: localId, name: inCat.name });
            nameToLocalId.set(inCat.name, localId);
        }
        const incomingIds = (incomingCategoryMembers && Array.isArray(incomingCategoryMembers[inCat.id]))
            ? incomingCategoryMembers[inCat.id] : [];
        const merged = new Set(localMembers[localId] || []);
        for (const id of incomingIds) if (validSetIds.has(id)) merged.add(id);
        if (merged.size) { localMembers[localId] = [...merged]; touched++; }
    }

    saveOsuCategories(localCategories);
    saveOsuCategoryMembers(localMembers);
    return touched;
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
        // Older share links (generated before categories were included)
        // simply won't have this field — mergeIncomingCategories no-ops on
        // an empty/missing array, so this stays backward compatible.
        mergeIncomingCategories(data.categories, data.categoryMembers);
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

async function addOsuBeatmap(explicitId) {
    if (!await verifyOsuPassword()) return;
    const input = document.getElementById('osuInput');
    const status = document.getElementById('osu-status');
    const raw = explicitId !== undefined ? String(explicitId).trim() : input.value.trim();
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

        if (parsed.isSet || parsed.type === 'url' && raw.includes('beatmapsets')) {
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
            const msg = t('osu_already_exists', { n: `${beatmaps[0].artist} - ${beatmaps[0].title}` });
            status.innerText = msg;
            status.style.color = '#f59e0b';
            if (explicitId !== undefined && typeof showShareToast === 'function') showShareToast(msg);
            return;
        }

        const setInfo = {
            beatmapset_id: parseInt(beatmaps[0].beatmapset_id),
            title: beatmaps[0].title,
            artist: beatmaps[0].artist,
            creator: beatmaps[0].creator,
            mode: modeNum,
            addedAt: new Date().toISOString(),
            beatmaps: beatmaps.map(b => ({
                beatmap_id: parseInt(b.beatmap_id),
                version: b.version,
                difficulty_rating: parseFloat(b.difficultyrating),
                hit_length: parseInt(b.hit_length),
                total_length: parseInt(b.total_length),
                bpm: parseFloat(b.bpm),
                key_count: parseFloat(b.diff_size),
                mode_int: parseInt(b.mode)
            })).sort((a, b) => a.difficulty_rating - b.difficulty_rating)
        };

        // Language/genre come from API v2 (the v1 fetch above only has a
        // coarse language_id) — non-blocking-ish: one extra ~300ms call,
        // and the add still succeeds if it fails (backfill will retry).
        const meta = await fetchOsuSetMeta(setInfo.beatmapset_id);
        if (meta) { setInfo.language = meta.language; setInfo.genre = meta.genre; }

        col[modeKey].unshift(setInfo);
        saveOsuCollection(col);

        status.innerText = t('osu_added', { n: `${setInfo.artist} - ${setInfo.title}`, m: OSU_MODE_LABELS[modeNum], k: setInfo.beatmaps.length });
        status.style.color = '#34d399';
        if (explicitId === undefined) input.value = '';
        else if (typeof showShareToast === 'function') showShareToast(t('osu_added', { n: `${setInfo.artist} - ${setInfo.title}`, m: OSU_MODE_LABELS[modeNum], k: setInfo.beatmaps.length }));

        osuCurrentTab = modeKey;
        osuPage = 0;
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
    osuMetaBackfillRunning = true;   // keep the page-load backfill out of the way

    try {
        for (let i = 0; i < allIds.length; i += REFRESH_CONCURRENCY) {
            const batch = allIds.slice(i, i + REFRESH_CONCURRENCY);
            const results = await Promise.all(batch.map(setId =>
                Promise.all([
                    osuFetch(`s=${setId}`).catch(() => []),
                    fetchOsuSetMeta(setId),
                ]).then(([beatmaps, meta]) => ({ setId, beatmaps, meta }))
            ));
            for (const { setId, beatmaps, meta } of results) {
                for (const mode of OSU_MODES) {
                    const idx = col[mode].findIndex(s => s.beatmapset_id === setId);
                    if (idx < 0) continue;
                    if (beatmaps.length > 0) {
                        col[mode][idx].beatmaps = beatmaps.map(b => ({
                            beatmap_id: parseInt(b.beatmap_id),
                            version: b.version,
                            difficulty_rating: parseFloat(b.difficultyrating),
                            hit_length: parseInt(b.hit_length),
                            total_length: parseInt(b.total_length),
                            bpm: parseFloat(b.bpm),
                            key_count: parseFloat(b.diff_size),
                            mode_int: parseInt(b.mode)
                        })).sort((a, b) => a.difficulty_rating - b.difficulty_rating);
                    }
                    if (meta) { col[mode][idx].language = meta.language; col[mode][idx].genre = meta.genre; }
                    break;
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
        osuMetaBackfillRunning = false;
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

/* ===== Collection stats dashboard — richer charts than the flat tiles
   above, all derived from data already in localStorage (no API calls).
   The growth chart is the one exception worth a note: sets added before
   `addedAt` existed (see addOsuBeatmap) have no timestamp, so they're
   bucketed into a single "already had these" starting point rather than
   guessing when they were actually added. ===== */
let statsDashboardCharts = [];

function openStatsDashboardModal() {
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m]).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });
    const body = document.getElementById('stats-dashboard-body');
    document.getElementById('stats-dashboard-modal').style.display = 'flex';

    if (allSets.length === 0) {
        body.innerHTML = `<p class="osu-empty">${t('stats_dashboard_empty')}</p>`;
        return;
    }

    body.innerHTML = `
        <div class="stats-dashboard-grid">
            <div class="stats-dashboard-card">
                <div class="pp-calc-section-label">${t('stats_dashboard_stars_title')}</div>
                <div class="trend-chart-wrap"><canvas id="stats-chart-stars"></canvas></div>
            </div>
            <div class="stats-dashboard-card">
                <div class="pp-calc-section-label">${t('stats_dashboard_modes_title')}</div>
                <div class="trend-chart-wrap"><canvas id="stats-chart-modes"></canvas></div>
            </div>
            <div class="stats-dashboard-card">
                <div class="pp-calc-section-label">${t('stats_dashboard_mappers_title')}</div>
                <div class="trend-chart-wrap"><canvas id="stats-chart-mappers"></canvas></div>
            </div>
            <div class="stats-dashboard-card">
                <div class="pp-calc-section-label">${t('stats_dashboard_langs_title')}</div>
                <div class="trend-chart-wrap"><canvas id="stats-chart-langs"></canvas></div>
            </div>
            <div class="stats-dashboard-card">
                <div class="pp-calc-section-label">${t('stats_dashboard_growth_title')}</div>
                <div class="trend-chart-wrap"><canvas id="stats-chart-growth"></canvas></div>
            </div>
        </div>
    `;
    // Canvases need real layout dimensions before Chart.js measures them.
    requestAnimationFrame(() => renderStatsDashboardCharts(col, allSets));
}

function closeStatsDashboardModal() {
    document.getElementById('stats-dashboard-modal').style.display = 'none';
    statsDashboardCharts.forEach(c => c.destroy());
    statsDashboardCharts = [];
}

function renderStatsDashboardCharts(col, allSets) {
    const colors = ppChartColors();
    const purple = getComputedStyle(document.documentElement).getPropertyValue('--accent-purple').trim() || '#a855f7';
    statsDashboardCharts.forEach(c => c.destroy());
    statsDashboardCharts = [];

    const starBuckets = new Array(9).fill(0);
    allSets.forEach(s => s.beatmaps.forEach(b => {
        starBuckets[Math.min(8, Math.max(0, Math.floor(b.difficulty_rating || 0)))]++;
    }));
    statsDashboardCharts.push(new Chart(document.getElementById('stats-chart-stars'), {
        type: 'bar',
        data: {
            labels: starBuckets.map((_, i) => i === 8 ? '8+' : `${i}-${i + 1}`),
            datasets: [{ data: starBuckets, backgroundColor: colors.accent, borderRadius: 4 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: colors.label, font: { size: 10 } } },
                y: { grid: { color: colors.grid }, ticks: { color: colors.label, font: { size: 10 }, precision: 0 } },
            },
        },
    }));

    statsDashboardCharts.push(new Chart(document.getElementById('stats-chart-modes'), {
        type: 'doughnut',
        data: {
            labels: OSU_MODE_LABELS,
            datasets: [{ data: OSU_MODES.map(m => col[m].length), backgroundColor: [colors.accent, purple, '#34d399', '#f59e0b'] }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: colors.text, font: { size: 10 }, boxWidth: 10 } } },
        },
    }));

    // Language mix — tally by v2 language id, missing -> "unlabeled" bucket.
    const langTally = new Map();
    allSets.forEach(s => {
        const key = s.language && s.language.id ? s.language.id : 'unknown';
        langTally.set(key, (langTally.get(key) || 0) + 1);
    });
    const langEntries = [...langTally.entries()].sort((a, b) => b[1] - a[1]);
    const langPalette = ['#f472b6', '#a855f7', '#c084fc', '#22d3ee', '#34d399', '#f59e0b', '#60a5fa', '#f87171', '#818cf8', '#fbbf24', '#4ade80', '#e879f9', '#2dd4bf', '#fb7185'];
    statsDashboardCharts.push(new Chart(document.getElementById('stats-chart-langs'), {
        type: 'doughnut',
        data: {
            labels: langEntries.map(([k]) => k === 'unknown'
                ? t('lang_unknown')
                : (OSU_LANGUAGES[k] ? `${OSU_LANGUAGES[k].flag} ${t(OSU_LANGUAGES[k].key)}` : String(k))),
            datasets: [{ data: langEntries.map(([, n]) => n), backgroundColor: langEntries.map((_, i) => langPalette[i % langPalette.length]) }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: colors.text, font: { size: 10 }, boxWidth: 10 } } },
        },
    }));

    const mapperCounts = new Map();
    allSets.forEach(s => { if (s.creator) mapperCounts.set(s.creator, (mapperCounts.get(s.creator) || 0) + 1); });
    const topMappers = [...mapperCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    statsDashboardCharts.push(new Chart(document.getElementById('stats-chart-mappers'), {
        type: 'bar',
        data: { labels: topMappers.map(m => m[0]), datasets: [{ data: topMappers.map(m => m[1]), backgroundColor: purple, borderRadius: 4 }] },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: colors.grid }, ticks: { color: colors.label, font: { size: 10 }, precision: 0 } },
                y: { grid: { display: false }, ticks: { color: colors.label, font: { size: 10 } } },
            },
        },
    }));

    const dated = allSets.filter(s => s.addedAt).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    const undatedCount = allSets.length - dated.length;
    const growthLabels = [];
    const growthData = [];
    let running = undatedCount;
    if (undatedCount > 0) { growthLabels.push(t('stats_dashboard_growth_baseline')); growthData.push(running); }
    const byDay = new Map();
    dated.forEach(s => { const day = s.addedAt.slice(0, 10); byDay.set(day, (byDay.get(day) || 0) + 1); });
    [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([day, count]) => {
        running += count;
        growthLabels.push(formatPpChartDate(day));
        growthData.push(running);
    });
    statsDashboardCharts.push(new Chart(document.getElementById('stats-chart-growth'), {
        type: 'line',
        data: {
            labels: growthLabels,
            datasets: [{
                data: growthData, borderColor: colors.accent, backgroundColor: colors.accent + '2a',
                pointRadius: 2.5, pointBackgroundColor: colors.accent, borderWidth: 2, tension: 0.25, fill: true,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: colors.grid }, ticks: { color: colors.label, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
                y: { grid: { color: colors.grid }, ticks: { color: colors.label, font: { size: 10 }, precision: 0 } },
            },
        },
    }));
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

/* ===== Landing hero (empty-collection state) =====
   A first-time visitor with nothing collected lands on an empty grid — this
   panel above it pitches what the site does and shows a couple of live
   numbers. Hidden the moment the collection has anything in it. */
let collectionHeroInit = false;

function updateCollectionHeroVisibility() {
    const hero = document.getElementById('collection-hero');
    if (!hero) return;
    const col = getOsuCollection();
    const empty = OSU_MODES.every(m => col[m].length === 0);
    hero.hidden = !empty;
    if (empty && !collectionHeroInit) initCollectionHero();
}

function initCollectionHero() {
    collectionHeroInit = true;
    const cta = document.getElementById('collection-hero-cta');
    if (cta) cta.hidden = !!getLoggedInOsuUser();

    const statsEl = document.getElementById('collection-hero-stats');
    if (!statsEl) return;
    Promise.allSettled([
        fetch('/.netlify/functions/collections-list?page=0').then(r => (r.ok ? r.json() : null)),
        fetch('/.netlify/functions/site-likes').then(r => (r.ok ? r.json() : null)),
    ]).then(([a, b]) => {
        const total = a.status === 'fulfilled' && a.value && typeof a.value.total === 'number' ? a.value.total : null;
        const likes = b.status === 'fulfilled' && b.value && typeof b.value.likes === 'number' ? b.value.likes : null;
        const parts = [];
        if (total != null) parts.push(t('hero_stat_collections', { n: total.toLocaleString() }));
        if (likes != null) parts.push(t('hero_stat_likes', { n: likes.toLocaleString() }));
        statsEl.textContent = parts.join('   ·   ');
    });
}

function renderOsuCollection() {
    const container = document.getElementById('osu-collection');
    const paginationEl = document.getElementById('osu-pagination');
    if (!container || !paginationEl) return;
    updateCollectionHeroVisibility();
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
        // A set is stored under exactly one mode array (whichever the API
        // reported for its first difficulty at add-time), but a crossover
        // set can still have individual difficulties in *other* modes — so
        // a mode tab must search every array for sets with a matching diff,
        // not just the array the set happens to be filed under. The current
        // tab's own array goes first so its natural newest-added-first order
        // (unshift on add) isn't pushed down by other arrays' entries ahead
        // of it — those only matter here as a fallback for crossover sets.
        const seen = new Set();
        const orderedModes = [osuCurrentTab, ...OSU_MODES.filter(m => m !== osuCurrentTab)];
        const allSets = orderedModes.flatMap(m => col[m].map(s => ({ ...s, __homeMode: m })));
        sets = allSets.filter(s => {
            if (seen.has(s.beatmapset_id)) return false;
            const hasTabMode = s.beatmaps.some(b => (OSU_MODE_NAMES[b.mode_int] || s.__homeMode) === osuCurrentTab);
            if (!hasTabMode) return false;
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

    // Language filter options track whatever's actually in this tab's sets;
    // do it before the language filter narrows `sets` so the dropdown still
    // lists every option.
    renderOsuLangFilterOptions(sets);
    if (osuLangFilter === 'unknown') {
        sets = sets.filter(s => !s.language);
    } else if (osuLangFilter !== 'all') {
        sets = sets.filter(s => s.language && String(s.language.id) === osuLangFilter);
    }

    sets = sortOsuSets(sets);

    if (sets.length === 0) {
        const msg = osuSearchQuery
            ? t('osu_search_empty')
            : osuCurrentTab === 'favorites'
                ? `${t('osu_empty_fav')}<br><span>${t('osu_empty_fav_hint')}</span>`
                : !OSU_MODES.includes(osuCurrentTab)
                    ? t('osu_empty_category')
                    : `${t('osu_empty_collection')}<br><span>${t('osu_empty_hint')}</span><br><span class="osu-empty-sub">${t('osu_empty_banner_hint')}</span>`;
        container.innerHTML = `<div class="osu-empty">${msg}</div>`;
        paginationEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(sets.length / OSU_PAGE_SIZE);
    if (osuPage >= totalPages) osuPage = totalPages - 1;
    if (osuPage < 0) osuPage = 0;
    const pageSets = sets.slice(osuPage * OSU_PAGE_SIZE, (osuPage + 1) * OSU_PAGE_SIZE);

    // Repopulated on every render so "checkCollectionPlayedStatus()" (the
    // 已遊玩 button) always checks exactly the sets currently on screen —
    // representative of each set by its hardest visible difficulty, so the
    // check stays bounded to one API call per card instead of one per
    // difficulty (a set can have a dozen).
    osuPageCheckTargets = [];

    container.innerHTML = pageSets.map(set => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/card.jpg`;
        const isFav = isOsuFavorited(set.beatmapset_id);
        // A beatmapset can mix rulesets (e.g. a taiko+mania crossover set) —
        // each difficulty may belong to a different mode than the set's own
        // collection category, so prefer each beatmap's own mode_int (added
        // via refresh) over set.__mode, falling back for un-refreshed data.
        const diffMode = (b) => OSU_MODE_NAMES[b.mode_int] || set.__mode;
        // On a mode tab (Standard/Taiko/Catch/Mania), only show this set's
        // difficulties that actually belong to that mode — a crossover set
        // shows its mania diffs under Mania and its taiko diffs under Taiko,
        // not all of them mixed together everywhere it's listed.
        const tabBeatmaps = OSU_MODES.includes(osuCurrentTab) ? set.beatmaps.filter(b => diffMode(b) === osuCurrentTab) : set.beatmaps;
        const diffBeatmaps = tabBeatmaps.length > 0 ? tabBeatmaps : set.beatmaps;
        const starsMin = Math.min(...diffBeatmaps.map(b => b.difficulty_rating));
        const starsMax = Math.max(...diffBeatmaps.map(b => b.difficulty_rating));
        const hardestDiff = diffBeatmaps.find(b => b.difficulty_rating === starsMax) || diffBeatmaps[diffBeatmaps.length - 1];
        const diffUrl = (beatmapId, mode) => `https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}#${OSU_API_MODE[mode] || 'osu'}/${beatmapId}`;
        // Mania beatmapsets often mix key counts (4K/7K/etc, from CS) across
        // difficulties of the same set — surface that in the hover label.
        const diffLabel = (b) => (diffMode(b) === 'mania' && b.key_count) ? `${b.version} [${Math.round(b.key_count)}K]` : b.version;
        const diffIconsRow = `<div class="osu-card-diff-row">${diffBeatmaps.map(b => modeDiffIcon(diffMode(b), b.difficulty_rating, diffLabel(b), diffUrl(b.beatmap_id, diffMode(b)))).join('')}</div>`;
        osuPageCheckTargets.push({ setId: set.beatmapset_id, beatmapId: hardestDiff.beatmap_id, mode: OSU_MODES.indexOf(diffMode(hardestDiff)) });
        // Language badge (API v2, via backfill / add / refresh). A set that
        // hasn't been backfilled yet shows 🌐 未標記 until it fills in.
        const langLabel = osuLangName(set) || t('lang_unknown');
        const langBadge = `<span class="osu-lang-badge" data-tip="${escHtml(langLabel)}">${set.language ? osuLangFlag(set) : '🌐'} ${escHtml(langLabel)}</span>`;
        return `
        <div class="osu-card" data-set-id="${set.beatmapset_id}" onclick="window.open('https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${set.beatmapset_id}, event)" title="複製 ID">${icon('copy')}</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${set.beatmapset_id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
            <button class="osu-ppcalc-btn" onclick="openPpCalcModal(${set.beatmapset_id}, event)" title="${t('pp_calc_btn_title')}">${icon('barChart3')}</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${set.beatmapset_id}, event)" title="播放預覽">${icon('play', { filled: true })}</button>
            <button class="osu-fav-btn ${isFav ? 'active' : ''}" onclick="toggleOsuFavorite(${set.beatmapset_id}, event)" title="${isFav ? '取消最愛' : '加入最愛'}">${icon('heart', { filled: isFav })}</button>
            <button class="osu-category-btn" onclick="toggleCategoryPicker(${set.beatmapset_id}, event)" title="${t('osu_category_btn_title')}">${icon('tag')}</button>
            <button class="osu-delete-btn" onclick="event.stopPropagation();removeOsuSet(${set.beatmapset_id})" title="移除">${icon('x')}</button>
            <div class="osu-card-mode-badge"><span class="mode-diff-icon" title="${escHtml((starsMin === starsMax ? `${starsMax.toFixed(2)} ⭐` : `${starsMin.toFixed(2)}~${starsMax.toFixed(2)} ⭐`) + (diffMode(hardestDiff) === 'mania' && hardestDiff.key_count ? ` [${Math.round(hardestDiff.key_count)}K]` : ''))}" onclick="event.stopPropagation();window.open('${diffUrl(hardestDiff.beatmap_id, diffMode(hardestDiff))}','_blank')" style="cursor:pointer">${modeIconSvg(diffMode(hardestDiff), starRatingColor(starsMax))}</span></div>
            <div class="osu-play-status" id="play-status-${set.beatmapset_id}" style="display:none;"></div>
            <div class="osu-card-info">
                ${langBadge}
                <div class="osu-card-title">${set.title}</div>
                ${diffIconsRow}
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
        pages += buildPaginationPageButtons(osuPage, totalPages, (i) => `osuPage=${i};renderOsuCollection()`);
        pages += `<button class="osu-page-btn" onclick="osuPage=Math.min(${totalPages-1},osuPage+1);renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>›</button>`;
        pages += `<button class="osu-page-btn" onclick="osuPage=${totalPages-1};renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>»</button>`;
        paginationEl.innerHTML = pages;
    }
}

/* ===== 收藏 vs 已遊玩比對 — cross-references the current page's collected
   sets against the logged-in osu! account's actual scores, via get_scores'
   own `u` filter (added as netlify/functions/osu.js's `scoreBeatmap`
   branch). Bounded to one score lookup per *set* (its hardest visible
   difficulty, from osuPageCheckTargets — see renderOsuCollection()) rather
   than per difficulty, and only for the visible page, rather than the
   whole collection, so a click here stays a handful of parallel requests
   instead of potentially hundreds. ===== */
async function checkCollectionPlayedStatus() {
    const user = getLoggedInOsuUser();
    const btn = document.getElementById('osu-check-played-btn');
    if (!user || osuPageCheckTargets.length === 0) return;

    if (btn) { btn.disabled = true; btn.classList.add('checking'); }
    try {
        await Promise.all(osuPageCheckTargets.map(async ({ setId, beatmapId, mode }) => {
            const el = document.getElementById(`play-status-${setId}`);
            if (!el || mode < 0) return;
            try {
                const scores = await osuFetch(`scoreBeatmap=${beatmapId}&scoreUser=${user.id}&m=${mode}`);
                const score = Array.isArray(scores) ? scores[0] : null;
                if (!score) {
                    el.className = 'osu-play-status unplayed';
                    el.title = t('play_status_unplayed_title');
                    el.textContent = '–';
                } else {
                    const rankClass = OSU_RANK_CLASS[score.rank] || 'f';
                    const isFc = (parseInt(score.countmiss) || 0) === 0;
                    el.className = `osu-play-status rank-${rankClass}`;
                    el.title = t(isFc ? 'play_status_fc_title' : 'play_status_played_title', { rank: score.rank || '?' });
                    el.textContent = score.rank || '?';
                }
                el.style.display = 'flex';
                // Reserves room in .osu-card-info's left padding so the badge
                // doesn't sit on top of the title/artist text below it — only
                // applied once a card is actually checked, so cards nobody's
                // checked yet keep their original (un-padded) layout.
                el.closest('.osu-card')?.classList.add('has-play-status');
            } catch (e) {
                console.error('Played-status check failed for beatmap', beatmapId, e);
            }
        }));
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('checking'); }
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

/* Handles both "最近遊玩" (get_user_recent) and "最佳成績" (get_user_best) —
   same response shape from the v1 API (score objects keyed by beatmap_id),
   the only real difference is which endpoint/limit to use and that best-play
   entries carry a `pp` field worth showing. See switchVisitorPlaysType(). */
/* Shimmering stand-ins for .osu-recent-item rows, shown in the list
   container while its fetch is in flight (see renderOsuPlaysList below). */
function playsListSkeletonHTML(count) {
    return Array.from({ length: count }, () => '<div class="osu-recent-item skeleton" aria-hidden="true"></div>').join('');
}

/* One .osu-recent-item card's markup — pulled out of renderOsuPlaysList so
   the two-player Top Play comparison (loadPpCompareTopPlays below) can
   build the exact same card for each side without duplicating this. */
function osuPlayItemHtml(r, mode, bm, type) {
    const title = bm ? `${bm.title} [${bm.version}]` : `Beatmap #${r.beatmap_id}`;
    const coverUrl = bm ? `https://assets.ppy.sh/beatmaps/${bm.beatmapset_id}/covers/card.jpg` : '';
    const acc = calcOsuAccuracy(r, mode);
    const rankClass = OSU_RANK_CLASS[r.rank] || 'f';
    const mods = decodeOsuMods(r.enabled_mods);
    const modsStr = mods.length > 0 ? ' · ' + mods.join(',') : '';
    const d = new Date(String(r.date).replace(' ', 'T') + 'Z');
    const dateStr = isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const ppStr = type === 'best' && r.pp != null ? `${Math.round(parseFloat(r.pp)).toLocaleString()}pp · ` : '';
    // rosu-pp-js (the FC-simulation backend) doesn't factor NF/SO
    // into difficulty/pp at all, so they're dropped from the mods
    // string sent to it — same convention netlify/functions/
    // replay-analyze.js already uses.
    const fcMods = mods.filter(m => m !== 'NF' && m !== 'SO').join('');
    return `<a class="osu-recent-item" href="https://osu.ppy.sh/b/${r.beatmap_id}" target="_blank" rel="noopener noreferrer">
        <div class="osu-recent-bg" style="background-image:url('${coverUrl}')"></div>
        <div class="osu-recent-overlay"></div>
        <span class="osu-recent-rank rank-${rankClass}">${r.rank || '—'}</span>
        <div class="osu-recent-info">
            <div class="osu-recent-song">${escHtml(title)}</div>
            <div class="osu-recent-meta">${ppStr}${acc}% · ${r.maxcombo}x${modsStr} · ${dateStr}</div>
            <button class="fc-sim-btn" onclick="toggleFcSim(event, ${r.beatmap_id}, '${fcMods}')" title="${escHtml(t('fc_sim_btn_title'))}">${icon('trendingUp')}<span>${t('fc_sim_btn')}</span></button>
        </div>
    </a>`;
}

/* Shared by renderOsuPlaysList (single-player recent/best list) and
   loadPpCompareTopPlays (two-player Top10 comparison, see comparePlayers
   below): fetch `best`/`recent` scores for one user+mode, batch-fetch the
   beatmap details each score references, and return the rendered card
   list HTML — '' on no scores or any failure, never throws, so a caller
   comparing two players never has one side's failure take down the other. */
async function fetchOsuPlaysHtml(userId, mode, type, limit) {
    try {
        const query = type === 'best' ? `best=${userId}&limit=${limit}&m=${mode}` : `recent=${userId}&limit=${limit}&m=${mode}`;
        const plays = await osuFetch(query);
        if (!plays || plays.length === 0) return '';
        const beatmapIds = [...new Set(plays.map(r => r.beatmap_id))];
        const beatmapResults = await Promise.all(beatmapIds.map(id => osuFetch(`b=${id}`)));
        const beatmapMap = {};
        beatmapIds.forEach((id, i) => {
            const bm = beatmapResults[i] && beatmapResults[i][0];
            if (bm) beatmapMap[id] = bm;
        });
        return plays.map(r => osuPlayItemHtml(r, mode, beatmapMap[r.beatmap_id], type)).join('');
    } catch (e) {
        console.error('Plays list fetch failed:', e);
        return '';
    }
}

async function renderOsuPlaysList(userId, mode, type, listId, wrapId) {
    const container = document.getElementById(listId);
    const wrap = document.getElementById(wrapId);
    if (!container || !wrap) return;
    container.innerHTML = playsListSkeletonHTML(type === 'best' ? 5 : 3);
    wrap.style.display = 'block';
    const html = await fetchOsuPlaysHtml(userId, mode, type, type === 'best' ? 10 : 5);
    if (!html) { wrap.style.display = 'none'; return; }
    container.innerHTML = html;
    wrap.style.display = 'block';
}

/* ===== "PP if FC" simulator — a single document.body-level popover (same
   lazy-singleton pattern as #osu-category-picker above: .osu-recent-item
   has overflow:hidden for its aspect-ratio background image, which would
   clip an inline result panel, and the list's innerHTML gets replaced
   wholesale on every re-render). Lazy-loaded per click rather than for
   every row up front, since each calculation downloads the raw .osu file
   server-side; results are cached in memory per beatmap+mods pair since
   the same map can appear more than once across the recent/best lists. ===== */
function ensureFcSimPopoverEl() {
    let el = document.getElementById('fc-sim-popover');
    if (!el) {
        el = document.createElement('div');
        el.id = 'fc-sim-popover';
        el.className = 'fc-sim-popover';
        document.body.appendChild(el);
    }
    return el;
}

let fcSimPopoverKey = null;
const fcSimCache = {};

async function toggleFcSim(event, beatmapId, mods) {
    // The row itself is an <a> to the beatmap page — without these, this
    // click would both open the popover AND navigate away.
    event.preventDefault();
    event.stopPropagation();
    const key = `${beatmapId}:${mods}`;
    const el = ensureFcSimPopoverEl();
    if (fcSimPopoverKey === key && el.classList.contains('open')) {
        closeFcSimPopover();
        return;
    }
    fcSimPopoverKey = key;
    const r = event.currentTarget.getBoundingClientRect();
    el.style.top = `${r.bottom + 6}px`;
    el.style.left = `${Math.min(r.left, window.innerWidth - 200)}px`;
    el.classList.add('open');
    document.addEventListener('click', onFcSimPopoverOutsideClick);
    document.addEventListener('keydown', onFcSimPopoverEscape);

    if (fcSimCache[key]) { el.innerHTML = fcSimCache[key]; return; }
    el.innerHTML = `<div class="fc-sim-loading">${t('fc_sim_loading')}</div>`;
    try {
        const res = await fetch(`/.netlify/functions/osu-pp?id=${beatmapId}&mods=${encodeURIComponent(mods)}`);
        const data = await res.json();
        if (!res.ok || data.error || !data.pp) throw new Error(data.error || 'bad response');
        const html = `<div class="fc-sim-title">${t('fc_sim_popover_title')}</div>` + Object.entries(data.pp)
            .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
            .map(([acc, pp]) => `<div class="fc-sim-row"><span>${parseFloat(acc)}%</span><b>${Math.round(pp).toLocaleString()}pp</b></div>`)
            .join('');
        fcSimCache[key] = html;
        if (fcSimPopoverKey === key) el.innerHTML = html;
    } catch (e) {
        console.error('FC simulation failed:', e);
        if (fcSimPopoverKey === key) el.innerHTML = `<div class="fc-sim-error">${t('fc_sim_error')}</div>`;
    }
}
function closeFcSimPopover() {
    const el = document.getElementById('fc-sim-popover');
    if (el) el.classList.remove('open');
    fcSimPopoverKey = null;
    document.removeEventListener('click', onFcSimPopoverOutsideClick);
    document.removeEventListener('keydown', onFcSimPopoverEscape);
}
function onFcSimPopoverOutsideClick(e) {
    if (!e.target.closest('#fc-sim-popover') && !e.target.closest('.fc-sim-btn')) closeFcSimPopover();
}
function onFcSimPopoverEscape(e) {
    if (e.key === 'Escape') closeFcSimPopover();
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

/* ===== Two-player PP comparison — reuses the exact same history sources as
   the single-player panel above (local daily snapshots + osu!Track via
   osu-pp-history.js), just fetched for two ids and rendered as two Chart.js
   datasets sharing a merged date axis instead of one. No new backend. ===== */
async function fetchPlayerTotalPpAndHistory(input, isUsername) {
    const param = isUsername ? `u=${encodeURIComponent(input)}&type=string` : `u=${input}`;
    const results = await Promise.all([0, 1, 2, 3].map(m => osuFetch(`${param}&m=${m}`)));
    const modeData = results.map(r => (r && r.length > 0) ? r[0] : null);
    const u = modeData[0];
    if (!u) return null;

    const totalPP = modeData.reduce((sum, m) => sum + (m && m.pp_raw != null ? parseFloat(m.pp_raw) : 0), 0);
    const key = ppHistoryKeyFor(u.user_id);
    if (totalPP > 0) recordPpSnapshot(totalPP, key);
    const remote = await fetchOsuTrackHistory(u.user_id);
    const history = mergePpHistory(remote, getPpHistory(key));
    return { id: u.user_id, username: u.username, country: u.country, totalPP, history };
}

/* flagcdn.com serves flags keyed by lowercase ISO 3166-1 alpha-2 — exactly
   what osu!'s `country` field already is, no lookup table needed. */
function flagUrl(countryCode) {
    return countryCode ? `https://flagcdn.com/24x18/${countryCode.toLowerCase()}.png` : '';
}

function renderPpCompareSide(elId, player) {
    const el = document.getElementById(elId);
    if (!el) return;
    const flag = flagUrl(player.country);
    el.innerHTML = `
        <div class="avatar-with-flag">
            <img class="osu-avatar pp-compare-avatar" src="${osuAvatarUrl(player.id)}" alt="" onerror="this.style.visibility='hidden';">
            ${flag ? `<img class="avatar-flag-badge" src="${flag}" alt="" onerror="this.style.display='none';">` : ''}
        </div>
        <div class="pp-compare-side-name">${escHtml(player.username)}</div>
        <div class="pp-compare-side-pp">${Math.round(player.totalPP).toLocaleString()}pp</div>
    `;
}

let ppCompareChart = null;
let ppCompareChartArgs = null;

function renderPpCompareChart(playerA, playerB, panelId) {
    const el = document.getElementById(panelId);
    if (!el) return;
    if (ppCompareChart) { ppCompareChart.destroy(); ppCompareChart = null; }

    const dates = [...new Set([...playerA.history.map(p => p.date), ...playerB.history.map(p => p.date)])].sort();
    if (dates.length < 2) {
        ppCompareChartArgs = null;
        el.innerHTML = `
            <div class="trend-chart-label">${t('pp_history_title')}</div>
            <p class="osu-empty">${t('pp_history_empty')}</p>
        `;
        return;
    }

    ppCompareChartArgs = [playerA, playerB, panelId];
    el.innerHTML = `
        <div class="trend-chart-label">${t('pp_history_title')}</div>
        <div class="trend-chart-wrap"><canvas></canvas></div>
    `;
    const canvas = el.querySelector('canvas');
    const colors = ppChartColors();
    const purple = getComputedStyle(document.documentElement).getPropertyValue('--accent-purple').trim() || '#a855f7';
    const seriesFor = (history) => {
        const byDate = new Map(history.map(p => [p.date, p.pp]));
        return dates.map(d => byDate.has(d) ? byDate.get(d) : null);
    };

    ppCompareChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: dates.map(formatPpChartDate),
            datasets: [
                {
                    label: playerA.username, data: seriesFor(playerA.history),
                    borderColor: colors.accent, backgroundColor: colors.accent + '2a',
                    pointBackgroundColor: colors.accent, pointBorderColor: colors.accent,
                    pointRadius: 2.5, pointHoverRadius: 5, borderWidth: 2, tension: 0.25, fill: false, spanGaps: true,
                },
                {
                    label: playerB.username, data: seriesFor(playerB.history),
                    borderColor: purple, backgroundColor: purple + '2a',
                    pointBackgroundColor: purple, pointBorderColor: purple,
                    pointRadius: 2.5, pointHoverRadius: 5, borderWidth: 2, tension: 0.25, fill: false, spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: true, labels: { color: colors.text, font: { size: 11 }, boxWidth: 12 } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    borderColor: colors.grid,
                    borderWidth: 1,
                    padding: 8,
                    callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toLocaleString() : '—'}pp` },
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

/* ===== Tracked-players "PP race" chart — same merged-date-axis approach as
   renderPpCompareChart() above, generalized from 2 fixed sides to however
   many players openTrackedLeaderboard() fetched. Colors cycle through a
   fixed palette (covers the pink/purple accents used everywhere else on
   the site first) and fall back to evenly-spaced HSL hues past that, so an
   arbitrarily long tracked-players list still gets visually distinct
   lines instead of repeating or clashing colors. ===== */
let ppRaceChart = null;
let ppRaceChartArgs = null;

function ppRaceColor(i, accent, purple) {
    const palette = [accent, purple, '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#f472b6', '#94a3b8'];
    if (i < palette.length) return palette[i];
    return `hsl(${(i * 47) % 360}, 70%, 60%)`;
}

function renderPpRaceChart(players, panelId) {
    const el = document.getElementById(panelId);
    if (!el) return;
    if (ppRaceChart) { ppRaceChart.destroy(); ppRaceChart = null; }

    const dates = [...new Set(players.flatMap(p => p.history.map(h => h.date)))].sort();
    if (dates.length < 2) {
        ppRaceChartArgs = null;
        el.innerHTML = `
            <div class="trend-chart-label">${t('pp_race_title')}</div>
            <p class="osu-empty">${t('pp_history_empty')}</p>
        `;
        return;
    }

    ppRaceChartArgs = [players, panelId];
    el.innerHTML = `
        <div class="trend-chart-label">${t('pp_race_title')}</div>
        <div class="trend-chart-wrap"><canvas></canvas></div>
    `;
    const canvas = el.querySelector('canvas');
    const colors = ppChartColors();
    const purple = getComputedStyle(document.documentElement).getPropertyValue('--accent-purple').trim() || '#a855f7';
    const seriesFor = (history) => {
        const byDate = new Map(history.map(p => [p.date, p.pp]));
        return dates.map(d => byDate.has(d) ? byDate.get(d) : null);
    };

    ppRaceChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: dates.map(formatPpChartDate),
            datasets: players.map((p, i) => {
                const c = ppRaceColor(i, colors.accent, purple);
                return {
                    label: p.username, data: seriesFor(p.history),
                    borderColor: c, backgroundColor: c + '2a',
                    pointBackgroundColor: c, pointBorderColor: c,
                    pointRadius: 2, pointHoverRadius: 4, borderWidth: 2, tension: 0.25, fill: false, spanGaps: true,
                };
            }),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: true, labels: { color: colors.text, font: { size: 11 }, boxWidth: 12 } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    borderColor: colors.grid,
                    borderWidth: 1,
                    padding: 8,
                    callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toLocaleString() : '—'}pp` },
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

/* Hides any previously-shown compare result so a blank player field never
   leaves stale comparison data on screen (mirrors clearVisitorLookupResult). */
function clearPpCompareResult() {
    const status = document.getElementById('pp-compare-status');
    const result = document.getElementById('pp-compare-result');
    const skeleton = document.getElementById('pp-compare-skeleton');
    if (status) status.innerText = '';
    if (result) result.style.display = 'none';
    if (skeleton) skeleton.style.display = 'none';
    ppCompareTopPlaysData = null;
    const topplaysWrap = document.getElementById('pp-compare-topplays');
    if (topplaysWrap) topplaysWrap.style.display = 'none';
}

function onPpCompareInputChange() {
    const inputA = document.getElementById('pp-compare-input-a').value.trim();
    const inputB = document.getElementById('pp-compare-input-b').value.trim();
    if (!inputA || !inputB) clearPpCompareResult();
}

async function comparePlayers() {
    const inputA = document.getElementById('pp-compare-input-a').value.trim();
    const inputB = document.getElementById('pp-compare-input-b').value.trim();
    const status = document.getElementById('pp-compare-status');
    const result = document.getElementById('pp-compare-result');
    const skeleton = document.getElementById('pp-compare-skeleton');
    if (!inputA || !inputB) { clearPpCompareResult(); return; }
    if (!status || !result) return;

    status.innerText = '';
    if (skeleton) skeleton.style.display = '';
    result.style.display = 'none';

    try {
        const [a, b] = await Promise.all([
            fetchPlayerTotalPpAndHistory(inputA, !/^\d+$/.test(inputA)),
            fetchPlayerTotalPpAndHistory(inputB, !/^\d+$/.test(inputB)),
        ]);
        if (skeleton) skeleton.style.display = 'none';
        if (!a || !b) { status.innerText = t('osu_not_found') || 'Not found'; status.style.color = '#ff5252'; return; }

        status.innerText = '';
        renderPpCompareSide('pp-compare-side-a', a);
        renderPpCompareSide('pp-compare-side-b', b);
        renderPpCompareChart(a, b, 'pp-compare-chart-panel');
        result.style.display = 'block';
        loadPpCompareTopPlays(a.id, b.id);
    } catch (e) {
        console.error('PP compare failed:', e);
        if (skeleton) skeleton.style.display = 'none';
        status.innerText = 'Error';
        status.style.color = '#ff5252';
    }
}

/* ===== Two-player Top Play comparison =====
   All 4 modes × both players (8 osuFetch('best=...') calls, each with its
   own beatmap-detail batch — see fetchOsuPlaysHtml) are fetched together
   up front rather than per-tab-click, so switching modes afterward is
   instant and a slow mode for one player doesn't block the others from
   appearing. Keyed by mode name (not the numeric index fetchOsuPlaysHtml
   itself needs) so switchPpCompareTopPlaysMode can just look results up by
   the same 'standard'/'taiko'/'catch'/'mania' ids the mode tabs use. */
let ppCompareTopPlaysData = null;
let ppCompareTopPlaysMode = 'standard';
let ppCompareTopPlaysRequestKey = null;

async function loadPpCompareTopPlays(idA, idB) {
    const wrap = document.getElementById('pp-compare-topplays');
    const listA = document.getElementById('pp-compare-topplays-a');
    const listB = document.getElementById('pp-compare-topplays-b');
    if (!wrap || !listA || !listB) return;

    ppCompareTopPlaysData = null;
    ppCompareTopPlaysMode = 'standard';
    document.querySelectorAll('#pp-compare-topplays-tabs .osu-mode-tab').forEach((btn, i) => btn.classList.toggle('active', i === 0));
    wrap.style.display = 'block';
    listA.innerHTML = playsListSkeletonHTML(5);
    listB.innerHTML = playsListSkeletonHTML(5);

    // Snapshot which pair this fetch is for — if the visitor re-compares a
    // different pair before this resolves, the stale response just gets
    // dropped instead of clobbering the newer one's list.
    const requestKey = `${idA}:${idB}`;
    ppCompareTopPlaysRequestKey = requestKey;

    const perMode = await Promise.all(OSU_MODES.map((mode, i) => Promise.all([
        fetchOsuPlaysHtml(idA, i, 'best', 10),
        fetchOsuPlaysHtml(idB, i, 'best', 10),
    ])));
    if (ppCompareTopPlaysRequestKey !== requestKey) return;

    ppCompareTopPlaysData = {};
    OSU_MODES.forEach((mode, i) => { ppCompareTopPlaysData[mode] = { a: perMode[i][0], b: perMode[i][1] }; });
    renderPpCompareTopPlays();
}

function switchPpCompareTopPlaysMode(mode, el) {
    ppCompareTopPlaysMode = mode;
    document.querySelectorAll('#pp-compare-topplays-tabs .osu-mode-tab').forEach(btn => btn.classList.remove('active'));
    if (el) el.classList.add('active');
    renderPpCompareTopPlays();
}

function renderPpCompareTopPlays() {
    if (!ppCompareTopPlaysData) return;
    const data = ppCompareTopPlaysData[ppCompareTopPlaysMode];
    const listA = document.getElementById('pp-compare-topplays-a');
    const listB = document.getElementById('pp-compare-topplays-b');
    const emptyHtml = `<div class="osu-empty">${t('pp_compare_topplays_empty')}</div>`;
    if (listA) listA.innerHTML = data.a || emptyHtml;
    if (listB) listB.innerHTML = data.b || emptyHtml;
}

/* Re-render with fresh colors on theme toggle so the chart doesn't keep
   its old-theme palette baked into the canvas (unlike the previous SVG
   version, which resolved CSS var() live and needed no such hook). */
(function () {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    themeBtn.addEventListener('click', () => setTimeout(() => {
        if (ppHistoryChartArgs) renderPpHistoryChart(...ppHistoryChartArgs);
        if (ppCompareChartArgs) renderPpCompareChart(...ppCompareChartArgs);
        if (ppRaceChartArgs) renderPpRaceChart(...ppRaceChartArgs);
    }, 0));
})();

/* ===== Visitor Profile Lookup ===== */
let visitorLookupUserId = null;
let visitorLookupUsername = '';
let visitorLookupCountry = '';
let visitorLookupTotalPp = 0;
let visitorPlaysType = 'recent';
let visitorModeData = [];
let visitorCurrentMode = 0;

function switchVisitorRecentMode(mode, el) {
    document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    visitorCurrentMode = mode;
    if (!visitorLookupUserId) return;
    if (visitorPlaysType === 'goal') renderPpGoalPlannerUI();
    else renderOsuPlaysList(visitorLookupUserId, mode, visitorPlaysType, 'visitor-recent-list', 'visitor-recent-plays');
}

function switchVisitorPlaysType(type, el) {
    visitorPlaysType = type;
    document.querySelectorAll('.osu-plays-type-tabs .osu-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const listEl = document.getElementById('visitor-recent-list');
    const goalEl = document.getElementById('pp-goal-planner');
    const medalsEl = document.getElementById('medals-gallery');
    listEl.style.display = type === 'recent' || type === 'best' ? '' : 'none';
    goalEl.style.display = type === 'goal' ? '' : 'none';
    medalsEl.style.display = type === 'medals' ? '' : 'none';
    if (type === 'goal') {
        renderPpGoalPlannerUI();
    } else if (type === 'medals') {
        ensureMedalsGalleryLoaded();
    } else if (visitorLookupUserId) {
        renderOsuPlaysList(visitorLookupUserId, visitorCurrentMode, type, 'visitor-recent-list', 'visitor-recent-plays');
    }
}

/* ===== Medal gallery — cross-references osekai.net's public medal database
   (name/icon/description/rarity, keyed by the same achievement id osu!'s
   own API uses) against the looked-up player's earned achievement ids, since
   osu!'s API only ever exposes bare ids (see osu-user-achievements.js and
   osekai-medals.js's header comments for why). The medal list itself is
   the same for everyone and rarely changes, so it's fetched once per page
   load and cached in osekaiMedalsPromise; only the "which ids does this
   player have" half changes per lookup. */
let osekaiMedalsPromise = null;
let allOsekaiMedals = [];
let visitorMedalIds = new Set();
let medalsLoadedForUserId = null;
let medalsFilterState = 'all';
let medalsSearchQuery = '';

function fetchOsekaiMedals() {
    if (!osekaiMedalsPromise) {
        osekaiMedalsPromise = fetch('/.netlify/functions/osekai-medals')
            .then(res => { if (!res.ok) throw new Error('bad response'); return res.json(); })
            .then(data => data.medals || [])
            .catch(e => { osekaiMedalsPromise = null; throw e; });
    }
    return osekaiMedalsPromise;
}

async function ensureMedalsGalleryLoaded() {
    const el = document.getElementById('medals-gallery');
    if (!el) return;
    if (!visitorLookupUserId) {
        el.innerHTML = `<p class="osu-empty">${t('medals_need_lookup')}</p>`;
        return;
    }
    if (medalsLoadedForUserId === visitorLookupUserId && allOsekaiMedals.length) {
        renderMedalsGallery();
        return;
    }
    el.innerHTML = `<p class="osu-empty">${t('medals_loading')}</p>`;
    try {
        const [medals, achRes] = await Promise.all([
            fetchOsekaiMedals(),
            fetch(`/.netlify/functions/osu-user-achievements?id=${visitorLookupUserId}`),
        ]);
        const achData = achRes.ok ? await achRes.json() : { achievements: [] };
        allOsekaiMedals = medals;
        visitorMedalIds = new Set(achData.achievements || []);
        medalsLoadedForUserId = visitorLookupUserId;
        renderMedalsGallery();
    } catch (e) {
        console.error('Medal gallery load failed:', e);
        el.innerHTML = `<p class="osu-empty">${t('medals_load_fail')}</p>`;
    }
}

function renderMedalsGallery() {
    const el = document.getElementById('medals-gallery');
    if (!el) return;
    medalsFilterState = 'all';
    medalsSearchQuery = '';
    const earnedCount = allOsekaiMedals.filter(m => visitorMedalIds.has(m.id)).length;
    el.innerHTML = `
        <div class="medals-gallery-header">
            <span class="medals-earned-count">${t('medals_earned_label', { n: earnedCount, total: allOsekaiMedals.length })}</span>
            <input type="text" class="medals-search-input guestbook-input" data-i18n-placeholder="medals_search_placeholder" placeholder="${t('medals_search_placeholder')}" oninput="medalsSearchGallery(this.value)">
        </div>
        <div class="osu-mode-tabs medals-filter-tabs">
            <button class="osu-tab active" onclick="medalsFilterGallery('all', this)">${t('medals_filter_all')}</button>
            <button class="osu-tab" onclick="medalsFilterGallery('earned', this)">${t('medals_filter_earned')}</button>
            <button class="osu-tab" onclick="medalsFilterGallery('missing', this)">${t('medals_filter_missing')}</button>
        </div>
        <div class="medals-grid" id="medals-grid"></div>
    `;
    renderMedalsList();
}

function medalsFilterGallery(filter, el) {
    medalsFilterState = filter;
    document.querySelectorAll('#medals-gallery .medals-filter-tabs .osu-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    renderMedalsList();
}

function medalsSearchGallery(value) {
    medalsSearchQuery = value.trim().toLowerCase();
    renderMedalsList();
}

function renderMedalsList() {
    const grid = document.getElementById('medals-grid');
    if (!grid) return;

    let list = allOsekaiMedals;
    if (medalsFilterState === 'earned') list = list.filter(m => visitorMedalIds.has(m.id));
    else if (medalsFilterState === 'missing') list = list.filter(m => !visitorMedalIds.has(m.id));
    if (medalsSearchQuery) list = list.filter(m => (m.name || '').toLowerCase().includes(medalsSearchQuery));

    if (list.length === 0) {
        grid.innerHTML = `<p class="osu-empty">${t('medals_empty')}</p>`;
        return;
    }

    // Grouped by osekai's own category field so related medals (e.g. all
    // "Beatmap Spotlights") sit together instead of one flat alphabetical wall.
    const groups = new Map();
    for (const m of list) {
        const g = m.grouping || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(m);
    }

    grid.innerHTML = [...groups.entries()].map(([group, medals]) => `
        <div class="medals-group">
            ${group ? `<div class="medals-group-title">${escapeHtmlOsu(group)}</div>` : ''}
            <div class="medals-group-grid">
                ${medals.map(m => {
                    const earned = visitorMedalIds.has(m.id);
                    return `
                    <div class="medal-item${earned ? ' earned' : ' missing'}" title="${escapeHtmlOsu(m.description || '')}">
                        <img class="medal-icon" src="${m.icon}" alt="${escapeHtmlOsu(m.name || '')}" loading="lazy" onerror="this.style.visibility='hidden'">
                        <div class="medal-name">${escapeHtmlOsu(m.name || '')}</div>
                        ${m.rarity != null ? `<div class="medal-rarity">${t('medals_rarity', { p: m.rarity.toFixed(1) })}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>
    `).join('');
}

/* ===== PP goal planner — "what pp does one new play need to reach a target
   total on this mode?" Reuses the same get_user_best endpoint as the Top
   Plays tab (fetched separately here at limit=100, osu!'s actual weighted-
   scoring window, vs. the tab's lighter limit=10 for browsing). The weighted
   formula (pp * 0.95^rank) is public (osu! wiki, "Performance points/
   Weighting system"); "bonus pp" (score-count based, ~400pp max) isn't
   reverse-engineered from its real formula — instead it's derived as
   actualTotalPP - weightedTop100Sum using data already on screen, which is
   exact rather than an approximation. */
function weightedPpSum(sortedDescPp) {
    return sortedDescPp.reduce((sum, pp, i) => sum + pp * Math.pow(0.95, i), 0);
}

function ppNeededForTarget(sortedDescPp, bonusPp, targetTotal) {
    let lo = 0, hi = 2000;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const merged = [...sortedDescPp, mid].sort((a, b) => b - a).slice(0, 100);
        if (weightedPpSum(merged) + bonusPp < targetTotal) lo = mid; else hi = mid;
    }
    return hi;
}

function renderPpGoalPlannerUI() {
    const el = document.getElementById('pp-goal-planner');
    if (!el) return;
    const modeData = visitorModeData[visitorCurrentMode];
    const currentPp = modeData && modeData.pp_raw != null ? Math.round(parseFloat(modeData.pp_raw)) : 0;
    el.innerHTML = `
        <p class="pp-goal-hint">${t('pp_goal_hint', { current: currentPp.toLocaleString(), mode: OSU_MODE_LABELS[visitorCurrentMode] })}</p>
        <div class="pp-goal-input-row">
            <input type="number" id="pp-goal-target" min="0" step="1" data-i18n-placeholder="pp_goal_placeholder" placeholder="目標總 PP">
            <button class="btn" onclick="calculatePpGoal()">${t('pp_goal_btn')}</button>
        </div>
        <div id="pp-goal-status" class="status"></div>
        <div id="pp-goal-result" class="pp-goal-result" style="display:none;"></div>
    `;
}

async function calculatePpGoal() {
    const target = parseFloat(document.getElementById('pp-goal-target').value);
    const status = document.getElementById('pp-goal-status');
    const resultEl = document.getElementById('pp-goal-result');
    resultEl.style.display = 'none';

    if (!Number.isFinite(target) || target <= 0) {
        status.innerText = t('pp_goal_invalid');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('osu_searching');
    status.style.color = '#f9a8d4';

    try {
        const top100 = await osuFetch(`best=${visitorLookupUserId}&limit=100&m=${visitorCurrentMode}`);
        const ppList = (top100 || []).map(s => parseFloat(s.pp)).filter(n => Number.isFinite(n)).sort((a, b) => b - a);
        const modeData = visitorModeData[visitorCurrentMode];
        const actualTotal = modeData && modeData.pp_raw != null ? parseFloat(modeData.pp_raw) : 0;
        const bonusPp = Math.max(0, actualTotal - weightedPpSum(ppList));

        status.innerText = '';
        if (actualTotal >= target) {
            resultEl.innerHTML = `<p class="pp-goal-achieved">${t('pp_goal_achieved')}</p>`;
        } else {
            const needed = ppNeededForTarget(ppList, bonusPp, target);
            resultEl.innerHTML = `
                <div class="osu-stat"><div class="osu-stat-value">${Math.round(needed).toLocaleString()}pp</div><div class="osu-stat-label">${t('pp_goal_result_label')}</div></div>
            `;
        }
        resultEl.style.display = 'block';
    } catch (e) {
        console.error('PP goal calc failed:', e);
        status.innerText = `${t('pp_calc_error')}${e.message ? ' (' + e.message + ')' : ''}`;
        status.style.color = '#ff5252';
    }
}

async function loadVisitorProfileById(input, isUsername) {
    const status = document.getElementById('visitor-lookup-status');
    const result = document.getElementById('visitor-lookup-result');
    const skeleton = document.getElementById('visitor-lookup-skeleton');
    status.innerText = '';
    if (skeleton) skeleton.style.display = '';
    result.style.display = 'none';

    const param = isUsername ? `u=${encodeURIComponent(input)}&type=string` : `u=${input}`;

    try {
        const results = await Promise.all([0,1,2,3].map(m => osuFetch(`${param}&m=${m}`)));
        if (skeleton) skeleton.style.display = 'none';
        const modeData = results.map(r => (r && r.length > 0) ? r[0] : null);
        visitorModeData = modeData;
        visitorCurrentMode = 0;
        const u = modeData[0];
        if (!u) { status.innerText = t('osu_not_found') || 'Not found'; status.style.color = '#ff5252'; return; }

        status.innerText = '';
        document.getElementById('visitor-avatar').src = osuAvatarUrl(u.user_id);
        document.getElementById('visitor-result-name').textContent = u.username;
        document.getElementById('visitor-result-country').textContent = COUNTRY_NAMES[u.country] || u.country;
        const flagEl = document.getElementById('visitor-flag');
        if (u.country) {
            flagEl.src = flagUrl(u.country);
            flagEl.alt = COUNTRY_NAMES[u.country] || u.country;
            flagEl.style.display = '';
        } else {
            flagEl.style.display = 'none';
        }

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
        visitorLookupUsername = u.username;
        visitorLookupCountry = u.country;
        visitorLookupTotalPp = totalPP;
        renderTrackButtonState();
        document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('#visitor-recent-mode-tabs .osu-mode-tab[data-mode="0"]').classList.add('active');
        visitorPlaysType = 'recent';
        document.querySelectorAll('.osu-plays-type-tabs .osu-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
        document.getElementById('visitor-recent-list').style.display = '';
        document.getElementById('pp-goal-planner').style.display = 'none';
        renderOsuPlaysList(u.user_id, 0, 'recent', 'visitor-recent-list', 'visitor-recent-plays');

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
        if (skeleton) skeleton.style.display = 'none';
        status.innerText = 'Error';
        status.style.color = '#ff5252';
    }
}

async function lookupVisitorProfile() {
    const input = document.getElementById('visitor-lookup-input').value.trim();
    if (!input) { clearVisitorLookupResult(); return; }
    loadVisitorProfileById(input, !/^\d+$/.test(input));
}

/* Hides any previously-shown lookup result and status message so a blank
   search box never displays stale player data. */
function clearVisitorLookupResult() {
    const status = document.getElementById('visitor-lookup-status');
    const result = document.getElementById('visitor-lookup-result');
    const skeleton = document.getElementById('visitor-lookup-skeleton');
    if (status) { status.innerText = ''; }
    if (result) result.style.display = 'none';
    if (skeleton) skeleton.style.display = 'none';
}

function onVisitorLookupInputChange() {
    if (!document.getElementById('visitor-lookup-input').value.trim()) clearVisitorLookupResult();
}

/* ===== Tracked players — lightweight "watch this player's PP" list, purely
   localStorage-backed (no login required, unlike the public-collections
   like/publish flow). js/notifications.js periodically re-fetches each
   tracked player's total PP and diffs it against the `lastPp` stored here
   to decide whether to surface a notification; this file only owns the
   list itself and the lookup-page UI for managing it. ===== */
const TRACKED_PLAYERS_KEY = 'osu_tracked_players';

function getTrackedPlayers() {
    try { return JSON.parse(localStorage.getItem(TRACKED_PLAYERS_KEY)) || []; }
    catch { return []; }
}

function saveTrackedPlayers(list) {
    localStorage.setItem(TRACKED_PLAYERS_KEY, JSON.stringify(list));
}

function isPlayerTracked(id) {
    return getTrackedPlayers().some(p => String(p.id) === String(id));
}

async function toggleTrackVisitorPlayer() {
    if (!visitorLookupUserId) return;
    const list = getTrackedPlayers();
    const idx = list.findIndex(p => String(p.id) === String(visitorLookupUserId));
    if (idx >= 0) {
        list.splice(idx, 1);
        showShareToast(t('untrack_done'));
    } else {
        const entry = { id: visitorLookupUserId, username: visitorLookupUsername || `#${visitorLookupUserId}`, country: visitorLookupCountry, lastPp: visitorLookupTotalPp || 0 };
        // Seed the achievement baseline the same way lastPp above is already
        // seeded from a real value — otherwise the first periodic check
        // (js/notifications.js's checkTrackedPlayers()) would
        // have to establish it anyway, but silently, one check cycle later.
        // Best-effort: if this fails, just leave the field unset so that
        // later check still recognizes it needs to baseline first rather
        // than treating "no field" as "zero achievements known".
        try {
            const res = await fetch(`/.netlify/functions/osu-user-achievements?id=${visitorLookupUserId}`);
            if (res.ok) entry.knownAchievementIds = (await res.json()).achievements || [];
        } catch (e) { /* left unset, notifications.js will baseline it later */ }
        list.push(entry);
        showShareToast(t('track_done'));
    }
    saveTrackedPlayers(list);
    renderTrackButtonState();
    renderTrackedPlayersList();
}

function untrackPlayerById(id) {
    saveTrackedPlayers(getTrackedPlayers().filter(p => String(p.id) !== String(id)));
    if (String(visitorLookupUserId) === String(id)) renderTrackButtonState();
    renderTrackedPlayersList();
}

function renderTrackButtonState() {
    const btn = document.getElementById('visitor-track-btn');
    if (!btn) return;
    if (!visitorLookupUserId) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    const tracked = isPlayerTracked(visitorLookupUserId);
    btn.textContent = tracked ? t('untrack_player_btn') : t('track_player_btn');
    btn.classList.toggle('tracked', tracked);
}

function renderTrackedPlayersList() {
    const panel = document.getElementById('tracked-players-panel');
    if (!panel) return;
    const list = getTrackedPlayers();
    if (list.length === 0) {
        panel.innerHTML = `<div class="tracked-players-empty">${t('tracked_players_empty')}</div>`;
        return;
    }
    const leaderboardBtn = list.length >= 2
        ? `<button class="tracked-leaderboard-btn" onclick="openTrackedLeaderboard()">${icon('trophy', { extraClass: 'icon-label-gap' })}${t('leaderboard_btn')}</button>` : '';
    panel.innerHTML = `
        <div class="tracked-players-title">${t('tracked_players_title')}${leaderboardBtn}</div>
        <div class="tracked-players-list">${list.map(p => `
            <div class="tracked-player-card" onclick="loadVisitorProfileById('${p.id}', false)">
                <div class="avatar-with-flag">
                    <img class="tracked-player-avatar" src="${osuAvatarUrl(p.id)}" alt="" onerror="this.style.visibility='hidden';">
                    ${p.country ? `<img class="avatar-flag-badge" src="${flagUrl(p.country)}" alt="" onerror="this.style.display='none';">` : ''}
                </div>
                <span class="tracked-player-name">${escapeHtmlOsu(p.username || ('#' + p.id))}</span>
                <span class="tracked-player-pp">${Math.round(p.lastPp || 0).toLocaleString()}pp</span>
                <button class="tracked-player-remove" onclick="event.stopPropagation();untrackPlayerById('${p.id}')" title="${t('untrack_player_btn')}">${icon('x')}</button>
            </div>`).join('')}
        </div>`;
}

/* ===== Tracked-players leaderboard — reuses fetchPlayerTotalPpAndHistory()
   (built for the two-player compare chart) across every tracked player in
   parallel rather than adding a separate fetch path. ===== */
async function openTrackedLeaderboard() {
    const players = getTrackedPlayers();
    if (players.length === 0) return;
    const listEl = document.getElementById('leaderboard-list');
    listEl.innerHTML = `<p class="osu-empty">${t('osu_searching')}</p>`;
    document.getElementById('leaderboard-modal').style.display = 'flex';

    try {
        const results = await Promise.all(players.map(p => fetchPlayerTotalPpAndHistory(String(p.id), false).catch(() => null)));
        const ranked = results.filter(Boolean).sort((a, b) => b.totalPP - a.totalPP);
        if (ranked.length === 0) {
            listEl.innerHTML = `<p class="osu-empty">${t('pp_calc_error')}</p>`;
            return;
        }
        listEl.innerHTML = ranked.map((p, i) => `
            <div class="leaderboard-row" onclick="closeTrackedLeaderboard();loadVisitorProfileById('${p.id}', false)">
                <span class="leaderboard-rank">#${i + 1}</span>
                <div class="avatar-with-flag">
                    <img class="leaderboard-avatar" src="${osuAvatarUrl(p.id)}" alt="" onerror="this.style.visibility='hidden';">
                    ${p.country ? `<img class="avatar-flag-badge" src="${flagUrl(p.country)}" alt="" onerror="this.style.display='none';">` : ''}
                </div>
                <span class="leaderboard-name">${escHtml(p.username)}</span>
                <span class="leaderboard-pp">${Math.round(p.totalPP).toLocaleString()}pp</span>
            </div>
        `).join('');
        renderPpRaceChart(ranked, 'tracked-leaderboard-chart');
    } catch (e) {
        console.error('Leaderboard load failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('pp_calc_error')}</p>`;
    }
}
function closeTrackedLeaderboard() {
    document.getElementById('leaderboard-modal').style.display = 'none';
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
    const checkPlayedBtn = document.getElementById('osu-check-played-btn');
    if (checkPlayedBtn) checkPlayedBtn.style.display = user ? '' : 'none';
    const profileImportBtn = document.getElementById('osu-import-profile-btn');
    if (profileImportBtn) profileImportBtn.style.display = user ? '' : 'none';
    const heroCta = document.getElementById('collection-hero-cta');
    if (heroCta) heroCta.hidden = !!user;
    if (typeof renderCloudSkinsList === 'function') renderCloudSkinsList();
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

    // First successful login on this device: if the collection is still empty,
    // offer to seed it from the visitor's own osu! profile (favourites +
    // most-played). Asked once — the toolbar button covers it after that.
    if (id && !localStorage.getItem('osu_profile_import_prompted')) {
        localStorage.setItem('osu_profile_import_prompted', '1');
        const col = getOsuCollection();
        if (OSU_MODES.every(m => col[m].length === 0)) {
            setTimeout(() => { if (confirm(t('osu_profile_import_confirm'))) importFromOsuProfile(); }, 500);
        }
    }
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
    document.getElementById('pp-calc-combo').value = '';
    document.getElementById('pp-calc-miss').value = 0;
    document.getElementById('pp-calc-status').innerText = '';
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
    document.getElementById('pp-calc-radar-wrap').style.display = 'none';
    document.getElementById('pp-calc-combo-label').style.display = 'none';
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
    document.getElementById('pp-calc-radar-wrap').style.display = 'none';
    document.getElementById('pp-calc-combo-label').style.display = 'none';
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
    document.getElementById('pp-calc-radar-wrap').style.display = 'none';
    document.getElementById('pp-calc-combo-label').style.display = 'none';
}

function renderPpCalcMods() {
    document.getElementById('pp-calc-mods-row').innerHTML = PP_MOD_LIST.map(mod =>
        `<button type="button" class="pp-calc-mod-chip ${ppCalcState.mods.has(mod) ? 'active' : ''}" onclick="togglePpCalcMod('${mod}')">${mod}</button>`
    ).join('');
}

async function osuPpFetch(beatmapId, mods, accList, combo, misses, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const params = new URLSearchParams({ id: beatmapId, mods, acc: accList.join(',') });
    if (combo !== undefined) params.set('combo', combo);
    if (misses !== undefined) params.set('misses', misses);
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
    const comboRaw = document.getElementById('pp-calc-combo').value.trim();
    const missRaw = document.getElementById('pp-calc-miss').value.trim();
    const status = document.getElementById('pp-calc-status');
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
    document.getElementById('pp-calc-radar-wrap').style.display = 'none';
    document.getElementById('pp-calc-combo-label').style.display = 'none';

    if (!Number.isFinite(acc) || acc < 0 || acc > 100) {
        status.innerText = t('pp_calc_acc_invalid');
        status.style.color = '#ff5252';
        return;
    }
    const combo = comboRaw === '' ? undefined : parseInt(comboRaw, 10);
    const misses = missRaw === '' ? 0 : parseInt(missRaw, 10);
    if ((combo !== undefined && (!Number.isInteger(combo) || combo < 0)) || !Number.isInteger(misses) || misses < 0) {
        status.innerText = t('pp_calc_combo_invalid');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('pp_calc_calculating');
    status.style.color = '#c8a2e0';

    const accList = [...new Set([acc, 95, 98, 100])].sort((a, b) => a - b);
    const modsStr = [...ppCalcState.mods].join('');

    try {
        const data = await osuPpFetch(ppCalcState.beatmapId, modsStr, accList, combo, misses);
        status.innerText = '';
        renderPpCalcResult(data, combo, misses);
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

/* Five-axis radar/spider chart (AR/OD/CS/HP + ★) — same hand-rolled-SVG
   approach as strainChartSvg/hitErrorChartSvg above rather than pulling in
   a charting library for one shape. AR/OD/CS/HP are normalized against 11
   (the practical ceiling once HR/mod stacking pushes a stat past its
   nominal 0-10 range) and ★ against 10 (a generous top-difficulty
   reference) — an axis maxing out at the outer ring just means "at or
   past that reference", which is expected and fine for a handful of
   extreme maps rather than something the chart needs to accommodate
   exactly. */
function difficultyRadarSvg(attrs, stars) {
    const width = 260, height = 250;
    const cx = width / 2, cy = height / 2 - 4;
    const R = 82;
    const axes = [
        { label: 'AR', value: attrs.ar, max: 11 },
        { label: 'OD', value: attrs.od, max: 11 },
        { label: 'CS', value: attrs.cs, max: 11 },
        { label: 'HP', value: attrs.hp, max: 11 },
        { label: '★', value: stars, max: 10 },
    ];
    const n = axes.length;
    const angleFor = i => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const pointFor = (i, frac) => [
        (cx + Math.cos(angleFor(i)) * R * frac).toFixed(2),
        (cy + Math.sin(angleFor(i)) * R * frac).toFixed(2),
    ];

    const rings = [0.25, 0.5, 0.75, 1].map(frac =>
        `<polygon points="${axes.map((_, i) => pointFor(i, frac).join(',')).join(' ')}" class="radar-ring" />`
    ).join('');
    const axisLines = axes.map((_, i) => {
        const [x, y] = pointFor(i, 1);
        return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis-line" />`;
    }).join('');
    const valuePts = axes.map((ax, i) => pointFor(i, Math.max(0, Math.min(1, ax.value / ax.max))).join(',')).join(' ');
    const labels = axes.map((ax, i) => {
        const [x, y] = pointFor(i, 1.24);
        return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" class="radar-axis-label">${ax.label} ${ax.value.toFixed(1)}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" class="difficulty-radar-svg">
        ${rings}${axisLines}
        <polygon points="${valuePts}" class="radar-value-fill" />
        ${labels}
    </svg>`;
}

function renderPpCalcResult(data, combo, misses) {
    const resultEl = document.getElementById('pp-calc-result');
    const comboLabel = document.getElementById('pp-calc-combo-label');
    if (comboLabel) {
        const comboStr = combo !== undefined ? `${Math.min(combo, data.maxCombo).toLocaleString()}x/${data.maxCombo.toLocaleString()}x` : t('pp_calc_combo_full', { max: data.maxCombo.toLocaleString() });
        const missStr = misses ? t('pp_calc_combo_misses', { n: misses }) : '';
        comboLabel.textContent = `${comboStr}${missStr}`;
        comboLabel.style.display = '';
    }

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

    const radarWrap = document.getElementById('pp-calc-radar-wrap');
    if (radarWrap && data.attrs) {
        radarWrap.innerHTML = `<div class="pp-calc-section-label">${t('pp_calc_radar_title')}</div>
            <div class="difficulty-radar-wrap">${difficultyRadarSvg(data.attrs, data.stars)}</div>`;
        radarWrap.style.display = 'block';
    }
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
