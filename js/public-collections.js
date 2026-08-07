/* ===== Public collection gallery =====
   Browse and download other players' published Beatmap collections — see
   netlify/functions/collections-{publish,unpublish,list,get}.js. One
   published collection per osu! user (republishing overwrites), so this is
   just a flat paginated list, no per-owner drill-down. Publishing requires
   a verified osu! login (getOsuAuthToken(), js/osu.js) since the server
   trusts nothing else about who's asking. ===== */
const PUBLIC_COLLECTIONS_PAGE_SIZE = 20;

let publicCollectionsLoaded = false;
let publicCollectionsPage = 0;
let publicCollectionsSort = 'recent';
let publicCollectionsItems = [];
let publicCollectionsTotal = 0;

function ensurePublicCollectionsLoaded() {
    updatePublishButtonLabel();
    if (!publicCollectionsLoaded) loadPublicCollectionsPage(0);
}

/* The Publish button's label reflects whether this browser has published
   before (osu_last_published_at, set on a successful publish and cleared on
   unpublish) — "發布" the first time, "更新" every time after, since
   publishing is always an overwrite (see collections-publish.js) rather
   than creating a second entry. This is a local-only convenience flag, not
   authoritative — if published from another browser/device it won't know,
   but re-publishing is harmless (still just overwrites the same entry). */
function getLastPublishedAt() {
    return localStorage.getItem('osu_last_published_at');
}

function updatePublishButtonLabel() {
    const btn = document.getElementById('publish-collection-btn');
    if (!btn) return;
    btn.textContent = getLastPublishedAt() ? t('publish_update_btn') : t('publish_btn');
}

function switchPublicCollectionsSort(sort) {
    publicCollectionsSort = sort;
    loadPublicCollectionsPage(0);
}

async function loadPublicCollectionsPage(page) {
    publicCollectionsLoaded = true;
    const listEl = document.getElementById('public-collections-list');
    const pageEl = document.getElementById('public-collections-pagination');
    if (!listEl) return;

    listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (pageEl) pageEl.innerHTML = '';

    try {
        const params = new URLSearchParams({ page, sort: publicCollectionsSort });
        const res = await fetch(`/.netlify/functions/collections-list?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        publicCollectionsPage = data.page || 0;
        publicCollectionsTotal = data.total || 0;
        publicCollectionsItems = data.items || [];
        renderPublicCollectionsList();
    } catch (e) {
        console.error('Public collections list failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('gallery_load_fail')}</p>`;
    }
}

function renderPublicCollectionsList() {
    const listEl = document.getElementById('public-collections-list');
    const pageEl = document.getElementById('public-collections-pagination');
    if (!listEl || !publicCollectionsLoaded) return;

    if (publicCollectionsItems.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('gallery_empty')}</p>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = publicCollectionsItems.map(item => `
        <div class="public-collection-card" onclick="openGalleryDetailModal(${item.id})">
            <div class="pcc-header">
                <img class="pcc-avatar" src="${osuAvatarUrl(item.id)}" alt="" onerror="this.style.visibility='hidden';">
                <div>
                    <div class="pcc-name">${escapeHtmlOsu(item.username || ('#' + item.id))}</div>
                    <div class="pcc-updated">${escapeHtmlOsu(String(item.updatedAt || '').slice(0, 10))}</div>
                </div>
            </div>
            <div class="pcc-stats">
                <span>${item.totalSets.toLocaleString()} ${t('osu_stats_total')}</span>
                <span>${item.maxRating.toFixed(2)}⭐</span>
            </div>
            <div class="pcc-btn-row">
                <button class="btn pcc-view-btn" onclick="event.stopPropagation();openGalleryDetailModal(${item.id})" title="${t('gallery_view_btn_title')}">🔍</button>
                <button class="btn pcc-download-btn" onclick="event.stopPropagation();downloadPublicCollection(${item.id})" title="${t('gallery_download_btn_title')}">⬇ ${t('gallery_download_btn_title')}</button>
            </div>
        </div>
    `).join('');

    if (!pageEl) return;
    const totalPages = Math.max(1, Math.ceil(publicCollectionsTotal / PUBLIC_COLLECTIONS_PAGE_SIZE));
    if (totalPages <= 1) {
        pageEl.innerHTML = '';
        return;
    }
    let pages = '';
    pages += `<button class="osu-page-btn" onclick="loadPublicCollectionsPage(0)" ${publicCollectionsPage === 0 ? 'disabled' : ''}>«</button>`;
    pages += `<button class="osu-page-btn" onclick="loadPublicCollectionsPage(Math.max(0,${publicCollectionsPage}-1))" ${publicCollectionsPage === 0 ? 'disabled' : ''}>‹</button>`;
    for (let i = 0; i < totalPages; i++) {
        pages += `<button class="osu-page-btn ${i === publicCollectionsPage ? 'active' : ''}" onclick="loadPublicCollectionsPage(${i})">${i + 1}</button>`;
    }
    pages += `<button class="osu-page-btn" onclick="loadPublicCollectionsPage(Math.min(${totalPages - 1},${publicCollectionsPage}+1))" ${publicCollectionsPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    pages += `<button class="osu-page-btn" onclick="loadPublicCollectionsPage(${totalPages - 1})" ${publicCollectionsPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    pageEl.innerHTML = pages;
}

async function publishMyCollection() {
    const token = getOsuAuthToken();
    if (!token) {
        showShareToast(t('publish_login_required'));
        return;
    }

    const col = getOsuCollection();
    const seen = new Set();
    OSU_MODES.forEach(m => col[m].forEach(s => seen.add(s.beatmapset_id)));
    if (seen.size === 0) {
        showShareToast(t('osu_share_link_empty'));
        return;
    }
    if (!confirm(t('publish_confirm', { n: seen.size }))) return;

    try {
        const res = await fetch('/.netlify/functions/collections-publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ collection: col, categories: getOsuCategories(), categoryMembers: getOsuCategoryMembers() }),
        });
        if (res.status === 401) {
            showShareToast(t('publish_login_required'));
            return;
        }
        if (!res.ok) throw new Error('publish failed');
        localStorage.setItem('osu_last_published_at', new Date().toISOString());
        updatePublishButtonLabel();
        showShareToast(t('publish_done'));
        if (publicCollectionsLoaded) loadPublicCollectionsPage(0);
    } catch (e) {
        console.error('Publish collection failed:', e);
        showShareToast(t('publish_fail'));
    }
}

async function unpublishMyCollection() {
    const token = getOsuAuthToken();
    if (!token) {
        showShareToast(t('publish_login_required'));
        return;
    }
    if (!confirm(t('unpublish_confirm'))) return;

    try {
        const res = await fetch('/.netlify/functions/collections-unpublish', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('unpublish failed');
        localStorage.removeItem('osu_last_published_at');
        updatePublishButtonLabel();
        showShareToast(t('unpublish_done'));
        if (publicCollectionsLoaded) loadPublicCollectionsPage(publicCollectionsPage);
    } catch (e) {
        console.error('Unpublish collection failed:', e);
        showShareToast(t('publish_fail'));
    }
}

/* Shared by the direct card download button and the detail modal's download
   button (openGalleryDetailModal already has the full data in hand, so it
   calls this directly instead of re-fetching). */
function importPublicCollectionData(data, fallbackName) {
    const incomingCount = OSU_MODES.reduce((sum, m) => sum + (data.collection[m] || []).length, 0);
    const name = data.username || fallbackName;
    if (!confirm(t('gallery_import_confirm', { name, n: incomingCount }))) return;

    const added = mergeIncomingCollection(data.collection);
    renderOsuCollection();
    showShareToast(t('osu_share_link_imported', { n: added }));
}

async function downloadPublicCollection(id) {
    const item = publicCollectionsItems.find(i => String(i.id) === String(id));
    try {
        const res = await fetch(`/.netlify/functions/collections-get?id=${id}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        importPublicCollectionData(data, (item && item.username) || `#${id}`);
    } catch (e) {
        console.error('Download public collection failed:', e);
        showShareToast(t('osu_share_link_import_fail'));
    }
}

/* ===== Gallery detail modal — view the beatmap list before downloading.
   Shows one mode's beatmaps at a time as a 4-column thumbnail grid, switched
   via mode tabs (same .osu-mode-tabs pattern as the visitor-lookup recent
   plays switcher), rather than stacking all four modes in one long list. ===== */
let galleryDetailData = null;
let galleryDetailMode = 'standard';

async function openGalleryDetailModal(id) {
    const item = publicCollectionsItems.find(i => String(i.id) === String(id));
    const modal = document.getElementById('gallery-detail-modal');
    const titleEl = document.getElementById('gallery-detail-title');
    const tabsEl = document.getElementById('gallery-detail-mode-tabs');
    const bodyEl = document.getElementById('gallery-detail-body');
    const downloadBtn = document.getElementById('gallery-detail-download-btn');

    galleryDetailData = null;
    titleEl.textContent = (item && item.username) || `#${id}`;
    tabsEl.innerHTML = '';
    bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    downloadBtn.style.display = 'none';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/.netlify/functions/collections-get?id=${id}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        galleryDetailData = data;
        if (data.username) titleEl.textContent = data.username;

        const modesWithItems = OSU_MODES.filter(m => (data.collection[m] || []).length > 0);
        // Categories are browse/filter-only here — never merged into the
        // viewer's own categories (see importPublicCollectionData, which
        // only ever touches `collection`), so only show ones the publisher
        // actually put beatmaps in.
        const categoriesWithItems = sortCategoriesByName(data.categories || [])
            .filter(c => ((data.categoryMembers && data.categoryMembers[c.id]) || []).length > 0);

        if (modesWithItems.length === 0 && categoriesWithItems.length === 0) {
            bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_empty')}</p>`;
            return;
        }

        const allTabIds = [...modesWithItems, ...categoriesWithItems.map(c => c.id)];
        galleryDetailMode = allTabIds.includes(galleryDetailMode) ? galleryDetailMode : (modesWithItems[0] || categoriesWithItems[0].id);

        const modeTabsHtml = modesWithItems.map(mode => {
            const i = OSU_MODES.indexOf(mode);
            const count = data.collection[mode].length;
            return `<button class="osu-mode-tab ${mode === galleryDetailMode ? 'active' : ''}" data-mode="${mode}" onclick="switchGalleryDetailMode('${mode}')">${modeIconSvg(mode)}${OSU_MODE_LABELS[i]} (${count})</button>`;
        }).join('');
        const categoryTabsHtml = categoriesWithItems.map(c => {
            const count = data.categoryMembers[c.id].length;
            return `<button class="osu-mode-tab ${c.id === galleryDetailMode ? 'active' : ''}" data-mode="${c.id}" onclick="switchGalleryDetailMode('${c.id}')">🏷 ${escapeHtmlOsu(c.name)} (${count})</button>`;
        }).join('');
        tabsEl.innerHTML = modeTabsHtml + categoryTabsHtml;

        renderGalleryDetailGrid();
        downloadBtn.style.display = '';
    } catch (e) {
        console.error('Gallery detail load failed:', e);
        bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_load_fail')}</p>`;
    }
}

function switchGalleryDetailMode(mode) {
    galleryDetailMode = mode;
    document.querySelectorAll('#gallery-detail-mode-tabs .osu-mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderGalleryDetailGrid();
}

function renderGalleryDetailGrid() {
    const bodyEl = document.getElementById('gallery-detail-body');
    if (!galleryDetailData) return;

    let sets;
    if (OSU_MODES.includes(galleryDetailMode)) {
        sets = galleryDetailData.collection[galleryDetailMode] || [];
    } else {
        // A category id — cross-mode, deduped, same pattern as
        // renderOsuCollection()'s own favorites/category filter branch.
        const memberIds = (galleryDetailData.categoryMembers && galleryDetailData.categoryMembers[galleryDetailMode]) || [];
        const seen = new Set();
        sets = OSU_MODES.flatMap(m => galleryDetailData.collection[m] || [])
            .filter(s => memberIds.includes(s.beatmapset_id) && !seen.has(s.beatmapset_id) && seen.add(s.beatmapset_id));
    }

    const cards = sets.map(set => {
        const maxDiff = (set.beatmaps || []).reduce((m, b) => Math.max(m, b.difficulty_rating || 0), 0);
        const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/card.jpg`;
        return `<a class="gallery-detail-item" href="https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}" target="_blank" rel="noopener noreferrer">
            <img class="gallery-detail-item-bg" src="${coverUrl}" alt="" loading="lazy" onerror="this.style.visibility='hidden';">
            <div class="gallery-detail-item-overlay"></div>
            <div class="gallery-detail-item-info">
                <span class="gallery-detail-item-title">${escapeHtmlOsu(set.title || ('#' + set.beatmapset_id))}</span>
                <span class="gallery-detail-item-stars">${maxDiff.toFixed(2)}⭐</span>
            </div>
        </a>`;
    }).join('');

    bodyEl.innerHTML = `<div class="gallery-detail-grid">${cards}</div>`;
}

function closeGalleryDetailModal() {
    document.getElementById('gallery-detail-modal').style.display = 'none';
    galleryDetailData = null;
}

function downloadGalleryDetailCollection() {
    if (!galleryDetailData) return;
    importPublicCollectionData(galleryDetailData, document.getElementById('gallery-detail-title').textContent);
    closeGalleryDetailModal();
}
