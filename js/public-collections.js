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
let publicCollectionsQuery = '';
let publicCollectionsTag = '';
let publicCollectionsLikedOnly = false;
let publicCollectionsSearchDebounce = null;

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
    const label = document.getElementById('publish-collection-label');
    if (!label) return;
    label.textContent = getLastPublishedAt() ? t('publish_update_btn') : t('publish_btn');
}

function switchPublicCollectionsSort(sort) {
    publicCollectionsSort = sort;
    loadPublicCollectionsPage(0);
}

/* Debounced so every keystroke doesn't fire a request — this is a server-
   side (keyword + tag) search over the gallery index, not a client-side
   filter over an already-loaded page, since only the server holds the full
   index. */
function searchPublicCollections(value) {
    publicCollectionsQuery = value.trim();
    clearTimeout(publicCollectionsSearchDebounce);
    publicCollectionsSearchDebounce = setTimeout(() => loadPublicCollectionsPage(0), 350);
}

function filterPublicCollectionsByTag(tag) {
    publicCollectionsTag = publicCollectionsTag === tag ? '' : tag;
    loadPublicCollectionsPage(0);
}

function toggleGalleryLikedOnly(checked) {
    if (checked && !getOsuAuthToken()) {
        showShareToast(t('gallery_like_login_required'));
        syncGalleryLikedOnlyCheckbox();
        return;
    }
    publicCollectionsLikedOnly = checked;
    loadPublicCollectionsPage(0);
}

function syncGalleryLikedOnlyCheckbox() {
    const cb = document.getElementById('gallery-liked-only-checkbox');
    if (cb) cb.checked = publicCollectionsLikedOnly;
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
        if (publicCollectionsQuery) params.set('q', publicCollectionsQuery);
        if (publicCollectionsTag) params.set('tag', publicCollectionsTag);
        if (publicCollectionsLikedOnly) params.set('likedOnly', '1');
        const token = getOsuAuthToken();
        const res = await fetch(`/.netlify/functions/collections-list?${params}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 401) {
            // Only happens for a likedOnly request whose token has expired
            // since the checkbox was checked — fall back to browsing everyone.
            publicCollectionsLikedOnly = false;
            syncGalleryLikedOnlyCheckbox();
            return loadPublicCollectionsPage(0);
        }
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

    renderGalleryActiveFilters();
    syncGalleryLikedOnlyCheckbox();

    if (publicCollectionsItems.length === 0) {
        const hasFilter = !!(publicCollectionsQuery || publicCollectionsTag || publicCollectionsLikedOnly);
        listEl.innerHTML = `<p class="osu-empty">${t(hasFilter ? 'gallery_no_results' : 'gallery_empty')}</p>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    const loggedInUser = getLoggedInOsuUser();

    listEl.innerHTML = publicCollectionsItems.map(item => {
        const isOwnCard = loggedInUser && String(loggedInUser.id) === String(item.id);
        const likeBtnHtml = isOwnCard ? '' : `
            <button class="pcc-like-btn ${item.likedByMe ? 'liked' : ''}" onclick="event.stopPropagation();toggleGalleryLike(${item.id}, this)" title="${t('gallery_like_btn_title')}">
                <span class="pcc-like-icon">${icon('heart', { filled: item.likedByMe })}</span><span class="pcc-like-count">${(item.likeCount || 0).toLocaleString()}</span>
            </button>`;
        const tagsHtml = (item.tags && item.tags.length) ? `<div class="pcc-tags">${item.tags.map(tag => `
            <span class="pcc-tag ${tag === publicCollectionsTag ? 'active' : ''}" onclick="event.stopPropagation();filterPublicCollectionsByTag(decodeURIComponent('${encodeURIComponent(tag)}'))">${icon('tag', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(tag)}</span>
        `).join('')}</div>` : '';

        return `
        <div class="public-collection-card" onclick="openGalleryDetailModal(${item.id})">
            <div class="pcc-header">
                <div class="avatar-with-flag">
                    <img class="pcc-avatar" src="${osuAvatarUrl(item.id)}" alt="" onerror="this.style.visibility='hidden';">
                    ${item.country ? `<img class="avatar-flag-badge" src="${flagUrl(item.country)}" alt="" onerror="this.style.display='none';">` : ''}
                </div>
                <div>
                    <div class="pcc-name">${escapeHtmlOsu(item.username || ('#' + item.id))}</div>
                    <div class="pcc-updated">${escapeHtmlOsu(String(item.updatedAt || '').slice(0, 10))}</div>
                </div>
                ${likeBtnHtml}
            </div>
            ${tagsHtml}
            <div class="pcc-stats">
                <span>${item.totalSets.toLocaleString()} ${t('osu_stats_total')}</span>
                <span>${item.maxRating.toFixed(2)}⭐</span>
            </div>
            <div class="pcc-btn-row">
                <button class="btn pcc-view-btn" onclick="event.stopPropagation();openGalleryDetailModal(${item.id})" title="${t('gallery_view_btn_title')}">${icon('search')}</button>
                <button class="btn pcc-download-btn" onclick="event.stopPropagation();downloadPublicCollection(${item.id})" title="${t('gallery_download_btn_title')}">${icon('download', { extraClass: 'icon-label-gap' })}${t('gallery_download_btn_title')}</button>
            </div>
        </div>`;
    }).join('');

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

function renderGalleryActiveFilters() {
    const el = document.getElementById('gallery-active-tag');
    if (!el) return;
    if (!publicCollectionsTag) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.style.display = '';
    el.innerHTML = `<span class="gallery-active-tag-pill">${icon('tag', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(publicCollectionsTag)}
        <button onclick="filterPublicCollectionsByTag(decodeURIComponent('${encodeURIComponent(publicCollectionsTag)}'))" title="${t('gallery_tag_filter_clear_title')}">${icon('x')}</button></span>`;
}

/* Optimistic-ish toggle: waits for the server's actual liked/count rather
   than flipping local state blindly, since the like might be rejected
   (expired login, or the target got unpublished between page load and
   click) — but only re-renders the one button touched instead of the whole
   list, so the rest of the grid (and scroll position) doesn't jump. */
async function toggleGalleryLike(id, btnEl) {
    const token = getOsuAuthToken();
    if (!token) {
        showShareToast(t('gallery_like_login_required'));
        return;
    }
    if (btnEl) btnEl.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/collections-like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ targetId: id }),
        });
        if (res.status === 401) {
            showShareToast(t('gallery_like_login_required'));
            return;
        }
        if (!res.ok) throw new Error('like failed');
        const data = await res.json();

        const item = publicCollectionsItems.find(i => String(i.id) === String(id));
        if (item) {
            item.likedByMe = data.liked;
            item.likeCount = data.likeCount;
        }
        if (btnEl) {
            btnEl.classList.toggle('liked', data.liked);
            btnEl.querySelector('.pcc-like-icon').innerHTML = icon('heart', { filled: data.liked });
            btnEl.querySelector('.pcc-like-count').textContent = data.likeCount.toLocaleString();
        }
    } catch (e) {
        console.error('Toggle gallery like failed:', e);
        showShareToast(t('gallery_like_fail'));
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
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

    // Best-effort — a failed lookup just means the gallery card shows no
    // flag, not a failed publish, so this is never allowed to block it.
    let country = null;
    try {
        const user = getLoggedInOsuUser();
        const profile = await osuFetch(`u=${user.id}&m=0`);
        country = profile && profile[0] && profile[0].country;
    } catch (e) {
        console.error('Failed to fetch country for publish:', e);
    }

    try {
        const res = await fetch('/.netlify/functions/collections-publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ collection: col, categories: getOsuCategories(), categoryMembers: getOsuCategoryMembers(), country }),
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
            return `<button class="osu-mode-tab ${c.id === galleryDetailMode ? 'active' : ''}" data-mode="${c.id}" onclick="switchGalleryDetailMode('${c.id}')">${icon('tag', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(c.name)} (${count})</button>`;
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
