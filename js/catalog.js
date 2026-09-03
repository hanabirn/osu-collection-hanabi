/* ===== Catalog tab: browse the whole ranked beatmap catalog by artist /
   language / genre / source / feat. name. Backed by this site's own
   metadata index (netlify/functions/catalog-list.js, fed by the
   catalog-crawl-cron.js background crawler — no star floor, no PP, one lean
   record per beatmapSET). The dataset is partial/growing, never implied
   complete — see renderCatalogCoverage(). =====

   Reuses osu.js helpers: OSU_GENRES / OSU_LANGUAGES (id -> localized name),
   escHtml, icon, buildPaginationPageButtons, addOsuBeatmap,
   applyImportedCollections. Frontend mode keys ('standard'/…) bridge to the
   API's ruleset ints via CATALOG_MODE_INT. */
const CATALOG_MODE_INT = { standard: 0, taiko: 1, catch: 2, mania: 3 };
const CATALOG_PAGE_SIZE = 20;

let catalogLoaded = false;
let catalogPage = 0;
let catalogQuery = '';
let catalogSort = 'ranked_desc';
let catalogMode = '';        // '' = all rulesets, else 'standard'|'taiko'|'catch'|'mania'
let catalogLang = 'all';     // 'all' | 'unknown' | '<language id>'
let catalogGenre = 'all';    // 'all' | 'unknown' | '<genre id>'
let catalogSource = 'all';   // 'all' | 'none' | '<source string>'
let catalogArtist = 'all';   // 'all' | '<artist key>'
let catalogNsfw = false;
let catalogItems = [];
let catalogTotal = 0;
let catalogCoverage = null;
let catalogFacets = null;
let catalogSearchDebounce = null;

function ensureCatalogLoaded() {
    if (!catalogLoaded) loadCatalogPage(0);
}

function catalogActiveFacet() {
    /* The single active metadata facet, or null when zero or more than one
       are set — the "build a collection" button only makes sense for one. */
    const active = [];
    if (catalogLang !== 'all') active.push(['language', catalogLang]);
    if (catalogGenre !== 'all') active.push(['genre', catalogGenre]);
    if (catalogSource !== 'all') active.push(['source', catalogSource]);
    if (catalogArtist !== 'all') active.push(['artist', catalogArtist]);
    return active.length === 1 ? { type: active[0][0], value: active[0][1] } : null;
}

function catalogFacetLabel(facet) {
    if (!facet) return '';
    if (facet.type === 'artist') return facet.value;
    if (facet.type === 'source') return facet.value === 'none' ? t('osu_source_filter_none') : facet.value;
    if (facet.type === 'language') {
        if (facet.value === 'unknown') return t('lang_unknown');
        const e = OSU_LANGUAGES[facet.value];
        return e ? t(e.key) : String(facet.value);
    }
    if (facet.type === 'genre') {
        if (facet.value === 'unknown') return t('genre_unspecified');
        return OSU_GENRES[facet.value] ? t(OSU_GENRES[facet.value]) : String(facet.value);
    }
    return '';
}

function catalogBuildParams(extra) {
    const params = new URLSearchParams({ sort: catalogSort });
    if (catalogQuery) params.set('q', catalogQuery);
    if (catalogMode) params.set('mode', String(CATALOG_MODE_INT[catalogMode]));
    if (catalogLang !== 'all') params.set('language', catalogLang);
    if (catalogGenre !== 'all') params.set('genre', catalogGenre);
    if (catalogSource !== 'all') params.set('source', catalogSource);
    if (catalogArtist !== 'all') params.set('artist', catalogArtist);
    if (catalogNsfw) params.set('includeNsfw', '1');
    for (const [k, v] of Object.entries(extra || {})) params.set(k, String(v));
    return params;
}

function switchCatalogMode(v) { catalogMode = v; loadCatalogPage(0); }
function switchCatalogSort(v) { catalogSort = v; loadCatalogPage(0); }
function switchCatalogLang(v) { catalogLang = v; loadCatalogPage(0); }
function switchCatalogGenre(v) { catalogGenre = v; loadCatalogPage(0); }
function switchCatalogSource(v) { catalogSource = v; loadCatalogPage(0); }
function switchCatalogArtist(v) { catalogArtist = v; loadCatalogPage(0); }
function toggleCatalogNsfw(checked) { catalogNsfw = checked; loadCatalogPage(0); }

function searchCatalog(value) {
    catalogQuery = value.trim();
    clearTimeout(catalogSearchDebounce);
    catalogSearchDebounce = setTimeout(() => loadCatalogPage(0), 350);
}

async function loadCatalogPage(page) {
    catalogLoaded = true;
    const listEl = document.getElementById('catalog-list');
    const pageEl = document.getElementById('catalog-pagination');
    if (!listEl) return;

    listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (pageEl) pageEl.innerHTML = '';

    try {
        const params = catalogBuildParams({ page });
        const res = await fetch(`/.netlify/functions/catalog-list?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        catalogPage = data.page || 0;
        catalogTotal = data.total || 0;
        catalogItems = data.items || [];
        catalogCoverage = data.coverage || null;
        catalogFacets = data.facets || null;
        rebuildCatalogFacetSelects();
        renderCatalogList();
    } catch (e) {
        console.error('Catalog list failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('catalog_load_fail')}</p>`;
    }
}

/* Rebuild the language / genre / source / artist <select>s from the facet
   counts the server returned, keeping the current selection even if it fell
   out of the top-N (append it as an extra option so it stays valid). */
function rebuildCatalogFacetSelects() {
    if (!catalogFacets) return;
    const f = catalogFacets;

    const langSel = document.getElementById('catalog-lang-filter');
    if (langSel) {
        let html = `<option value="all">${t('osu_lang_filter_all')}</option>`;
        for (const { id, count } of (f.languages || [])) {
            if (id === 'unknown') { html += `<option value="unknown">🌐 ${t('lang_unknown')} (${count})</option>`; continue; }
            const e = OSU_LANGUAGES[id];
            const name = e ? t(e.key) : String(id);
            const flag = e ? e.flag : '🌐';
            html += `<option value="${id}">${flag} ${escHtml(name)} (${count})</option>`;
        }
        langSel.innerHTML = html;
        langSel.value = [...langSel.options].some(o => o.value === catalogLang) ? catalogLang : (catalogLang = 'all');
    }

    const genreSel = document.getElementById('catalog-genre-filter');
    if (genreSel) {
        let html = `<option value="all">${t('osu_genre_filter_all')}</option>`;
        for (const { id, count } of (f.genres || [])) {
            if (id === 'unknown') { html += `<option value="unknown">${t('genre_unspecified')} (${count})</option>`; continue; }
            const name = OSU_GENRES[id] ? t(OSU_GENRES[id]) : String(id);
            html += `<option value="${id}">${escHtml(name)} (${count})</option>`;
        }
        genreSel.innerHTML = html;
        genreSel.value = [...genreSel.options].some(o => o.value === catalogGenre) ? catalogGenre : (catalogGenre = 'all');
    }

    const srcSel = document.getElementById('catalog-source-filter');
    if (srcSel) {
        let html = `<option value="all">${t('osu_source_filter_all')}</option>`;
        if (f.noSourceCount) html += `<option value="none">${t('osu_source_filter_none')} (${f.noSourceCount})</option>`;
        const sources = (f.topSources || []).slice();
        if (catalogSource !== 'all' && catalogSource !== 'none' && !sources.some(s => s.name === catalogSource)) {
            sources.push({ name: catalogSource, count: '·' });
        }
        for (const { name, count } of sources) {
            html += `<option value="${escHtml(name)}">${escHtml(name)} (${count})</option>`;
        }
        srcSel.innerHTML = html;
        srcSel.value = [...srcSel.options].some(o => o.value === catalogSource) ? catalogSource : (catalogSource = 'all');
    }

    const artistSel = document.getElementById('catalog-artist-filter');
    if (artistSel) {
        let html = `<option value="all">${t('osu_artist_filter_all')}</option>`;
        const artists = (f.topArtists || []).slice();
        if (catalogArtist !== 'all' && !artists.some(a => a.key === catalogArtist)) {
            artists.push({ key: catalogArtist, count: '·' });
        }
        for (const { key, count } of artists) {
            html += `<option value="${escHtml(key)}">${escHtml(key)} (${count})</option>`;
        }
        artistSel.innerHTML = html;
        artistSel.value = [...artistSel.options].some(o => o.value === catalogArtist) ? catalogArtist : (catalogArtist = 'all');
    }

    const btn = document.getElementById('catalog-create-collection-btn');
    if (btn) {
        const facet = catalogActiveFacet();
        btn.disabled = !facet;
        btn.title = facet
            ? t('catalog_create_collection_btn') + '：' + catalogFacetLabel(facet)
            : t('catalog_create_collection_hint');
    }
}

function renderCatalogList() {
    const listEl = document.getElementById('catalog-list');
    const pageEl = document.getElementById('catalog-pagination');
    if (!listEl || !catalogLoaded) return;

    renderCatalogCoverage();

    if (catalogItems.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('catalog_empty')}</p>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id))
    );

    listEl.innerHTML = catalogItems.map(item => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${item.id}/covers/card.jpg`;
        const inCollection = collectionSet.has(item.id);
        const langEntry = item.language_id != null ? OSU_LANGUAGES[item.language_id] : null;
        const langBadge = langEntry ? `<span title="${escHtml(t(langEntry.key))}">${langEntry.flag} ${escHtml(t(langEntry.key))}</span>` : '';
        const genreBadge = item.genre_id && OSU_GENRES[item.genre_id] ? `<span>${escHtml(t(OSU_GENRES[item.genre_id]))}</span>` : '';
        const sourceBadge = item.source ? `<span class="catalog-source-badge" title="${escHtml(item.source)}">${escHtml(item.source)}</span>` : '';
        const stars = (item.star_min != null && item.star_max != null)
            ? (item.star_min === item.star_max ? item.star_min.toFixed(2) : `${item.star_min.toFixed(2)}–${item.star_max.toFixed(2)}`)
            : '';
        return `
        <div class="osu-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${item.id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addCatalogToCollection(${item.id}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${item.id}, event)" title="複製 ID">${icon('copy')}</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${item.id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${item.id}, event)" title="播放預覽">${icon('play', { filled: true })}</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${escHtml(item.title || '')}</div>
                <div class="osu-card-artist">${escHtml(item.artist || '')}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: escHtml(item.creator || '') })}</div>
                <div class="catalog-card-meta">
                    ${stars ? `<span>${stars}★ · ${item.diff_count}譜</span>` : ''}
                    ${langBadge}${genreBadge}${sourceBadge}
                </div>
            </div>
        </div>`;
    }).join('');

    if (!pageEl) return;
    const totalPages = Math.max(1, Math.ceil(catalogTotal / CATALOG_PAGE_SIZE));
    if (totalPages <= 1) { pageEl.innerHTML = ''; return; }
    let pages = '';
    pages += `<button class="osu-page-btn" onclick="loadCatalogPage(0)" ${catalogPage === 0 ? 'disabled' : ''}>«</button>`;
    pages += `<button class="osu-page-btn" onclick="loadCatalogPage(Math.max(0,${catalogPage}-1))" ${catalogPage === 0 ? 'disabled' : ''}>‹</button>`;
    pages += buildPaginationPageButtons(catalogPage, totalPages, (i) => `loadCatalogPage(${i})`);
    pages += `<button class="osu-page-btn" onclick="loadCatalogPage(Math.min(${totalPages - 1},${catalogPage}+1))" ${catalogPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    pages += `<button class="osu-page-btn" onclick="loadCatalogPage(${totalPages - 1})" ${catalogPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    pageEl.innerHTML = pages;
}

function renderCatalogCoverage() {
    const el = document.getElementById('catalog-coverage');
    if (!el) return;
    if (!catalogCoverage || !catalogCoverage.lastRunAt) {
        el.textContent = t('catalog_coverage_pending');
        return;
    }
    const updated = new Date(catalogCoverage.lastRunAt).toLocaleString();
    el.textContent = t('catalog_coverage', {
        n: (catalogCoverage.datasetSize || 0).toLocaleString(),
        t: updated,
        m: catalogTotal.toLocaleString(),
    });
}

/* Called from refreshDynamicContent() on a site-language switch — the facet
   <select>s are built in JS (data-i18n can't reach their <option>s) so they
   and the cards need an explicit re-localize. */
function refreshCatalogLocalized() {
    if (!catalogLoaded) return;
    rebuildCatalogFacetSelects();
    renderCatalogList();
}

async function addCatalogToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderCatalogList();
}

/* Pull every set id matching the one active facet (capped server-side at
   300) and file them under a new category named after that facet, reusing
   the collection-import tail. */
async function catalogCreateCollectionFromFacet() {
    const facet = catalogActiveFacet();
    if (!facet) return;
    const label = catalogFacetLabel(facet);
    const btn = document.getElementById('catalog-create-collection-btn');

    let ids = [];
    try {
        if (btn) { btn.disabled = true; btn.textContent = t('gallery_loading'); }
        const params = catalogBuildParams({ limit: 300 });
        const res = await fetch(`/.netlify/functions/catalog-list?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        ids = (data.items || []).map(x => x.id).filter(Boolean);
    } catch (e) {
        console.error('Catalog facet fetch failed:', e);
        alert(t('catalog_load_fail'));
        if (btn) { btn.disabled = false; btn.textContent = t('catalog_create_collection_btn'); }
        return;
    }

    if (ids.length === 0) {
        alert(t('catalog_empty'));
        if (btn) { btn.disabled = false; btn.textContent = t('catalog_create_collection_btn'); }
        return;
    }
    if (!confirm(t('catalog_create_collection_confirm', { name: label, n: ids.length }))) {
        if (btn) { btn.disabled = false; btn.textContent = t('catalog_create_collection_btn'); }
        return;
    }

    const named = [{ name: label, entries: ids.map(id => ({ setId: id })) }];
    try {
        const report = await applyImportedCollections(named, (msg) => { if (btn) btn.textContent = msg; });
        alert(t('catalog_create_collection_done', { name: label, n: report.addedSets, cat: report.touchedCats }));
    } catch (e) {
        console.error('Catalog import failed:', e);
        alert(t('catalog_load_fail'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('catalog_create_collection_btn'); }
    }
}
