/* ===== Farm Maps tab: browse the ranked pool by PP/star/BPM/length for a
   handful of common mod combos, similar in spirit to third-party "farm map"
   browsers like osu-pps.com — except the PP numbers here are computed by
   this site's own backend (netlify/functions/farm-maps-list.js, fed by the
   farm-crawl-cron.js / farm-crawl-run.js background crawler, both using the
   same rosu-pp-js engine as the single-map PP calculator). The dataset is
   necessarily partial/growing rather than a full ranked-pool snapshot, see
   renderFarmCoverage() below — never implied as complete. =====

   This site's frontend mode keys ('standard'/'taiko'/'catch'/'mania', see
   OSU_MODES in js/osu.js) differ from the osu! API's own mode strings
   ('osu'/'taiko'/'fruits'/'mania') used by the backend dataset — FARM_MODE_TO_API
   bridges the two so the rest of this file can stay in the frontend's
   vocabulary (shared modeIconSvg() etc.) right up until the fetch call. */
const FARM_MODE_TO_API = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };
const FARM_MOD_COMBOS = ['NM', 'DT', 'HD', 'HDDT', 'HR', 'HDHR'];
const FARM_PAGE_SIZE = 20;

let farmMapsLoaded = false;
let farmMode = 'standard';
let farmMods = 'NM';
let farmSort = 'pp_desc';
let farmPage = 0;
let farmQuery = '';
let farmItems = [];
let farmTotal = 0;
let farmCoverage = null;
let farmSearchDebounce = null;
let farmFiltersDebounce = null;

function ensureFarmMapsLoaded() {
    if (!farmMapsLoaded) loadFarmMapsPage(0);
}

function switchFarmMode(mode, btn) {
    farmMode = mode;
    document.querySelectorAll('#farm-mode-tabs .osu-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadFarmMapsPage(0);
}

function switchFarmMods(mods, btn) {
    farmMods = mods;
    document.querySelectorAll('#farm-mods-tabs .osu-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadFarmMapsPage(0);
}

function switchFarmSort(value) {
    farmSort = value;
    loadFarmMapsPage(0);
}

function searchFarmMaps(value) {
    farmQuery = value.trim();
    clearTimeout(farmSearchDebounce);
    farmSearchDebounce = setTimeout(() => loadFarmMapsPage(0), 350);
}

/* Shared debounce for the 8 min/max range inputs — any of them changing
   re-queries the server (filtering happens server-side over the full
   dataset, same reasoning as searchPublicCollections in
   js/public-collections.js: the client never holds the whole dataset). */
function debounceFarmFilters() {
    clearTimeout(farmFiltersDebounce);
    farmFiltersDebounce = setTimeout(() => loadFarmMapsPage(0), 350);
}

async function loadFarmMapsPage(page) {
    farmMapsLoaded = true;
    const listEl = document.getElementById('farm-maps-list');
    const pageEl = document.getElementById('farm-maps-pagination');
    if (!listEl) return;

    listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (pageEl) pageEl.innerHTML = '';

    try {
        const params = new URLSearchParams({
            mode: FARM_MODE_TO_API[farmMode] || 'osu',
            mods: farmMods,
            sort: farmSort,
            page: String(page),
        });
        if (farmQuery) params.set('q', farmQuery);
        // pp-min -> ppMin, star-max -> starMax, etc.
        const field = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        [['pp-min', 'ppMin'], ['pp-max', 'ppMax'], ['star-min', 'starMin'], ['star-max', 'starMax'],
         ['bpm-min', 'bpmMin'], ['bpm-max', 'bpmMax'], ['length-min', 'lengthMin'], ['length-max', 'lengthMax']]
            .forEach(([elSuffix, param]) => {
                const value = field(`farm-${elSuffix}`);
                if (value !== '') params.set(param, value);
            });

        const res = await fetch(`/.netlify/functions/farm-maps-list?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        farmPage = data.page || 0;
        farmTotal = data.total || 0;
        farmItems = data.items || [];
        farmCoverage = data.coverage || null;
        renderFarmMapsList();
    } catch (e) {
        console.error('Farm maps list failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('farm_load_fail')}</p>`;
    }
}

function farmFormatLength(seconds) {
    if (!seconds && seconds !== 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function renderFarmMapsList() {
    const listEl = document.getElementById('farm-maps-list');
    const pageEl = document.getElementById('farm-maps-pagination');
    if (!listEl || !farmMapsLoaded) return;

    renderFarmCoverage();

    if (farmItems.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('farm_empty')}</p>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    // Computed once per render (not per card) so checking "already collected"
    // stays O(items) instead of re-parsing localStorage per card.
    const collectionSet = new Set((getOsuCollection()[farmMode] || []).map(s => s.beatmapset_id));

    listEl.innerHTML = farmItems.map(item => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${item.beatmapset_id}/covers/card.jpg`;
        const lengthStr = farmFormatLength(item.total_length);
        const inCollection = collectionSet.has(item.beatmapset_id);
        return `
        <div class="osu-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${item.beatmapset_id}#${FARM_MODE_TO_API[farmMode]}/${item.beatmap_id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addFarmMapToCollection(${item.beatmapset_id}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${item.beatmapset_id}, event)" title="複製 ID">${icon('copy')}</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${item.beatmapset_id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${item.beatmapset_id}, event)" title="播放預覽">${icon('play', { filled: true })}</button>
            <div class="osu-card-mode-badge">${modeDiffIcon(farmMode, item.star, (farmMode === 'mania' && item.cs) ? `${item.version} [${Math.round(item.cs)}K]` : item.version)}</div>
            <div class="osu-card-info">
                <div class="osu-card-title">${escapeHtmlOsu(item.title || '')} <span class="farm-card-version">[${escapeHtmlOsu(item.version || '')}]</span></div>
                <div class="farm-card-meta" title="${t('farm_filter_length')}: ${lengthStr}">
                    <span class="farm-card-pp">${Math.round(item.pp || 0)}pp</span>
                    <span>${(item.star || 0).toFixed(2)}⭐</span>
                    <span>${Math.round(item.bpm || 0)} BPM</span>
                </div>
                <div class="osu-card-artist">${escapeHtmlOsu(item.artist || '')}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: escapeHtmlOsu(item.creator || '') })}</div>
            </div>
        </div>`;
    }).join('');

    if (!pageEl) return;
    const totalPages = Math.max(1, Math.ceil(farmTotal / FARM_PAGE_SIZE));
    if (totalPages <= 1) {
        pageEl.innerHTML = '';
        return;
    }
    let pages = '';
    pages += `<button class="osu-page-btn" onclick="loadFarmMapsPage(0)" ${farmPage === 0 ? 'disabled' : ''}>«</button>`;
    pages += `<button class="osu-page-btn" onclick="loadFarmMapsPage(Math.max(0,${farmPage}-1))" ${farmPage === 0 ? 'disabled' : ''}>‹</button>`;
    pages += buildPaginationPageButtons(farmPage, totalPages, (i) => `loadFarmMapsPage(${i})`);
    pages += `<button class="osu-page-btn" onclick="loadFarmMapsPage(Math.min(${totalPages - 1},${farmPage}+1))" ${farmPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    pages += `<button class="osu-page-btn" onclick="loadFarmMapsPage(${totalPages - 1})" ${farmPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    pageEl.innerHTML = pages;
}

function renderFarmCoverage() {
    const el = document.getElementById('farm-coverage');
    if (!el) return;
    if (!farmCoverage || !farmCoverage.lastRunAt) {
        el.textContent = t('farm_coverage_pending');
        return;
    }
    const updated = new Date(farmCoverage.lastRunAt).toLocaleString();
    el.textContent = t('farm_coverage', { n: (farmCoverage.computedCount || 0).toLocaleString(), t: updated });
}

async function addFarmMapToCollection(beatmapsetId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(beatmapsetId));
    renderFarmMapsList();
}
