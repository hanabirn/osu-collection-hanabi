/* ===== Global search — one search box that queries the site's three big,
   previously-separate content sources at once (個人收藏 / 曲庫分類 /
   世界盃圖池) and jumps straight into whichever tab has the match. Each of
   those already has its own full-featured in-tab search; this is a thin
   "which tab has this?" dispatcher on top, not a replacement for them —
   results are capped small (5 per source) and clicking one just opens that
   tab with its own search box prefilled (or, for mappools, the matching
   edition selected), rather than trying to render a full results page here.

   Reuses globals from osu.js (escHtml, t, icon, OSU_MODES, getOsuCollection,
   filterOsuCollection, switchTab) and mappools.js (ensureMappoolsLoaded,
   mappoolIndex, switchMappoolEdition). Loaded after both. ===== */
let globalSearchDebounce = null;
let globalSearchToken = 0;

function openGlobalSearch() {
    const modal = document.getElementById('global-search-modal');
    const input = document.getElementById('global-search-input');
    const results = document.getElementById('global-search-results');
    if (!modal || !input || !results) return;
    modal.style.display = 'flex';
    input.value = '';
    results.innerHTML = '';
    setTimeout(() => input.focus(), 0);
    document.addEventListener('keydown', onGlobalSearchEscape);
}

function closeGlobalSearch() {
    const modal = document.getElementById('global-search-modal');
    if (modal) modal.style.display = 'none';
    document.removeEventListener('keydown', onGlobalSearchEscape);
}

function onGlobalSearchEscape(e) {
    if (e.key === 'Escape') closeGlobalSearch();
}

function onGlobalSearchInput(value) {
    clearTimeout(globalSearchDebounce);
    const q = value.trim();
    const resultsEl = document.getElementById('global-search-results');
    if (!resultsEl) return;
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = `<p class="osu-empty">${t('osu_searching')}</p>`;
    globalSearchDebounce = setTimeout(() => runGlobalSearch(q), 300);
}

/* Own-collection matches never leave the browser — getOsuCollection() is
   already fully loaded in memory, so this is synchronous, unlike the other
   two sources which need a network round trip. */
function searchOsuCollectionLocal(q) {
    if (typeof getOsuCollection !== 'function' || typeof OSU_MODES === 'undefined') return [];
    const col = getOsuCollection();
    const lowerQ = q.toLowerCase();
    const seen = new Set();
    const out = [];
    for (const mode of OSU_MODES) {
        for (const s of (col[mode] || [])) {
            if (seen.has(s.beatmapset_id)) continue;
            const hay = `${s.title || ''} ${s.artist || ''} ${s.creator || ''}`.toLowerCase();
            if (!hay.includes(lowerQ)) continue;
            seen.add(s.beatmapset_id);
            out.push(s);
            if (out.length >= 5) return out;
        }
    }
    return out;
}

async function runGlobalSearch(q) {
    const myToken = ++globalSearchToken;
    const resultsEl = document.getElementById('global-search-results');
    if (!resultsEl) return;

    const collectionResults = searchOsuCollectionLocal(q);
    let catalogResults = [];
    let mappoolResults = [];
    try {
        const [catRes, poolRes] = await Promise.all([
            fetch(`/.netlify/functions/catalog-list?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/.netlify/functions/wc-mappools-list?q=${encodeURIComponent(q)}&limit=5`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (catRes && Array.isArray(catRes.items)) catalogResults = catRes.items.slice(0, 5);
        if (poolRes && Array.isArray(poolRes.results)) mappoolResults = poolRes.results.slice(0, 5);
    } catch (e) { /* best-effort — partial results still beat none */ }

    if (myToken !== globalSearchToken) return; // superseded by a newer keystroke

    const sections = [
        globalSearchSectionHtml('global_search_section_collection', collectionResults, globalSearchCollectionItemHtml),
        globalSearchSectionHtml('global_search_section_catalog', catalogResults, globalSearchCatalogItemHtml),
        globalSearchSectionHtml('global_search_section_mappools', mappoolResults, globalSearchMappoolItemHtml),
    ].join('');

    resultsEl.innerHTML = sections || `<p class="osu-empty">${t('global_search_empty')}</p>`;
}

function globalSearchSectionHtml(titleKey, items, itemFn) {
    if (!items.length) return '';
    return `<div class="global-search-section">
        <div class="global-search-section-title">${t(titleKey)}</div>
        ${items.map(itemFn).join('')}
    </div>`;
}

function globalSearchItemRow(coverUrl, title, subtitle, action, query) {
    return `<div class="global-search-item" data-action="${action}" data-query="${escHtml(query)}">
        <div class="global-search-item-cover" style="background-image:url('${coverUrl}')"></div>
        <div class="global-search-item-text">
            <div class="global-search-item-title">${escHtml(title)}</div>
            <div class="global-search-item-subtitle">${escHtml(subtitle)}</div>
        </div>
    </div>`;
}

function globalSearchCollectionItemHtml(s) {
    return globalSearchItemRow(
        `https://assets.ppy.sh/beatmaps/${s.beatmapset_id}/covers/card.jpg`,
        s.title || '', s.artist || '', 'collection', s.title || s.artist || '',
    );
}

function globalSearchCatalogItemHtml(item) {
    return globalSearchItemRow(
        `https://assets.ppy.sh/beatmaps/${item.id}/covers/card.jpg`,
        item.title || '', item.artist || '', 'catalog', item.title || item.artist || '',
    );
}

function globalSearchMappoolItemHtml(m) {
    return globalSearchItemRow(
        `https://assets.ppy.sh/beatmaps/${m.beatmapId}/covers/card.jpg`,
        m.title || `#${m.beatmapId}`, `${m.artist || ''} · ${m.label || m.folder}`, 'mappool', m.folder,
    );
}

/* Delegated click on the results container — data attributes rather than
   inline onclick with dynamic strings, since titles can contain quotes/
   unicode that would otherwise need fragile escaping into a JS string
   literal embedded in an HTML attribute. */
document.addEventListener('click', (e) => {
    const item = e.target.closest('.global-search-item');
    if (!item) return;
    const { action, query } = item.dataset;
    closeGlobalSearch();
    if (action === 'collection') {
        switchTab('collection');
        const input = document.getElementById('osu-search-input');
        if (input) input.value = query;
        if (typeof filterOsuCollection === 'function') filterOsuCollection(query);
    } else if (action === 'catalog') {
        switchTab('catalog');
        const input = document.getElementById('catalog-search-input');
        if (input) input.value = query;
        if (typeof searchCatalog === 'function') searchCatalog(query);
    } else if (action === 'mappool') {
        openMappoolEditionFromSearch(query);
    }
});

/* mappoolIndex loads asynchronously (ensureMappoolsLoaded), so a result
   clicked before it's ready needs to wait rather than no-op — bounded so a
   load failure doesn't poll forever. */
function openMappoolEditionFromSearch(folder) {
    switchTab('mappools');
    if (typeof ensureMappoolsLoaded !== 'function') return;
    ensureMappoolsLoaded();
    if (typeof mappoolIndex !== 'undefined' && mappoolIndex) {
        switchMappoolEdition(folder);
        return;
    }
    let tries = 0;
    const poll = setInterval(() => {
        tries++;
        if (typeof mappoolIndex !== 'undefined' && mappoolIndex) {
            clearInterval(poll);
            switchMappoolEdition(folder);
        } else if (tries > 40) {
            clearInterval(poll);
        }
    }, 200);
}
