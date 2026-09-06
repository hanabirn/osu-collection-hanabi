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
    const freshCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    listEl.innerHTML = publicCollectionsItems.map(item => {
        const isNew = item.updatedAt && Date.parse(item.updatedAt) >= freshCutoff;
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
                    <div class="pcc-name">${escapeHtmlOsu(item.username || ('#' + item.id))}${isNew ? `<span class="pcc-new-badge">${t('gallery_new_badge')}</span>` : ''}</div>
                    <div class="pcc-updated">${escapeHtmlOsu(String(item.updatedAt || '').slice(0, 10))}</div>
                </div>
                ${likeBtnHtml}
            </div>
            ${tagsHtml}
            <div class="pcc-stats">
                <span>${item.totalSets.toLocaleString()} ${t('osu_stats_total')}</span>
                ${item.avgRating != null ? `<span>${item.avgRating.toFixed(2)}⭐ ${t('osu_stats_avg_rating')}</span>` : ''}
                <span>${item.maxRating.toFixed(2)}⭐ ${t('osu_stats_max_rating')}</span>
            </div>
            <div class="pcc-btn-row">
                <button class="btn pcc-view-btn" onclick="event.stopPropagation();openGalleryDetailModal(${item.id})" title="${t('gallery_view_btn_title')}">${icon('search')}</button>
                <button class="btn pcc-share-btn" onclick="shareCollectionLink(${item.id}, event)" title="${t('gallery_share_btn')}">${icon('share2')}</button>
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
    pages += buildPaginationPageButtons(publicCollectionsPage, totalPages, (i) => `loadPublicCollectionsPage(${i})`);
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
    if (typeof isOsuAuthTokenExpired === 'function' && isOsuAuthTokenExpired()) {
        osuReloginPrompt();
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
            osuReloginPrompt();
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
    if (typeof isOsuAuthTokenExpired === 'function' && isOsuAuthTokenExpired()) {
        osuReloginPrompt();
        return;
    }
    if (!confirm(t('unpublish_confirm'))) return;

    try {
        const res = await fetch('/.netlify/functions/collections-unpublish', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) { osuReloginPrompt(); return; }
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
let galleryScoresOverlaid = false;
/* The map grid pages 12 at a time (3 cols × 4 rows) so the comment box
   below it stays reachable without scrolling past a whole collection. */
let galleryDetailPage = 0;
const GALLERY_DETAIL_PAGE_SIZE = 12;
/* setId -> { cls, text, title } from "疊上我的成績", so the badges survive
   a page turn without re-hitting the score API for every set again. */
const galleryDetailScoreCache = new Map();
let galleryDetailScoreTally = null;

async function openGalleryDetailModal(id) {
    const item = publicCollectionsItems.find(i => String(i.id) === String(id));
    const modal = document.getElementById('gallery-detail-modal');
    const titleEl = document.getElementById('gallery-detail-title');
    const tabsEl = document.getElementById('gallery-detail-mode-tabs');
    const bodyEl = document.getElementById('gallery-detail-body');
    const downloadBtn = document.getElementById('gallery-detail-download-btn');

    galleryDetailData = null;
    galleryScoresOverlaid = false;
    galleryDetailPage = 0;
    galleryDetailScoreCache.clear();
    galleryDetailScoreTally = null;
    titleEl.textContent = (item && item.username) || `#${id}`;
    tabsEl.innerHTML = '';
    bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    downloadBtn.style.display = 'none';
    const shareBtn = document.getElementById('gallery-detail-share-btn');
    if (shareBtn) shareBtn.style.display = 'none';
    const embedBtn = document.getElementById('gallery-detail-embed-btn');
    if (embedBtn) embedBtn.style.display = 'none';
    modal.style.display = 'flex';
    // Independent of the collection fetch below — a comment thread on this
    // user's gallery post should still work even if, say, their collection
    // data itself failed to load.
    if (typeof loadGalleryComments === 'function') loadGalleryComments(id);

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
        if (shareBtn) shareBtn.style.display = '';
        if (embedBtn) embedBtn.style.display = '';
        const scoresBtn = document.getElementById('gallery-detail-scores-btn');
        if (scoresBtn) {
            const loggedIn = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
            scoresBtn.style.display = loggedIn ? '' : 'none';
            const lbl = scoresBtn.querySelector('span');
            if (lbl) lbl.textContent = t('gallery_scores_btn');
        }
    } catch (e) {
        console.error('Gallery detail load failed:', e);
        bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_load_fail')}</p>`;
    }
}

/* Copy a crawler-friendly /c/<id> link for a published collection (see
   netlify/functions/collection-share-page.js) — unfurls into an OpenGraph
   card. Native share sheet on mobile, clipboard elsewhere. */
function shareCollectionLink(id, event) {
    if (event) event.stopPropagation();
    if (id == null) return;
    const url = `${location.origin}/c/${id}`;
    if (navigator.share) { navigator.share({ url }).catch(() => {}); return; }
    const done = () => { if (typeof showShareToast === 'function') showShareToast(t('gallery_share_copied')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
}
function shareGalleryDetailLink() {
    if (galleryDetailData) shareCollectionLink(galleryDetailData.id);
}

/* Copy an <iframe> snippet for the open collection — a card to embed on a
   forum post / blog / tournament sheet (served by
   netlify/functions/embed-collection.js). */
function embedGalleryDetailCollection() {
    if (!galleryDetailData) return;
    const src = `${location.origin}/.netlify/functions/embed-collection?id=${galleryDetailData.id}`;
    const snippet = `<iframe src="${src}" width="480" height="220" style="border:0;border-radius:14px;max-width:100%" loading="lazy" title="osu! collection"></iframe>`;
    const done = () => { if (typeof showShareToast === 'function') showShareToast(t('gallery_embed_copied')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(snippet).then(done, done);
    else done();
}

/* Deep link: /c/<id> rewrites to the share page which bounces here as
   /?c=<id>; open that collection's detail modal on load. */
function checkGalleryDeepLink() {
    const params = new URLSearchParams(location.search);
    const id = params.get('c') || params.get('gallery');
    if (!id || !/^\d+$/.test(id)) return;
    params.delete('c');
    params.delete('gallery');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    const navBtn = document.querySelector('.site-nav-btn[onclick*="public-collections"]');
    if (typeof switchTab === 'function') switchTab('public-collections', navBtn || undefined);
    openGalleryDetailModal(id);
}

function switchGalleryDetailMode(mode) {
    galleryDetailMode = mode;
    galleryDetailPage = 0;
    galleryDetailScoreTally = null;   // per-view aggregate; the per-set cache still stands
    document.querySelectorAll('#gallery-detail-mode-tabs .osu-mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderGalleryDetailGrid();
}

function gotoGalleryDetailPage(page) {
    const total = Math.max(1, Math.ceil(galleryDetailVisibleSets().length / GALLERY_DETAIL_PAGE_SIZE));
    galleryDetailPage = Math.min(Math.max(0, page | 0), total - 1);
    renderGalleryDetailGrid();
    // Land back at the top of the grid, not wherever the last page's scroll was.
    const anchor = document.getElementById('gallery-detail-mode-tabs');
    if (anchor) anchor.scrollIntoView({ block: 'nearest' });
}

/* The sets shown by the current mode/category tab — shared by the grid
   renderer and the "疊上我的成績" overlay so both see the same list. */
function galleryDetailVisibleSets() {
    if (!galleryDetailData) return [];
    if (OSU_MODES.includes(galleryDetailMode)) {
        return galleryDetailData.collection[galleryDetailMode] || [];
    }
    // A category id — cross-mode, deduped, same pattern as
    // renderOsuCollection()'s own favorites/category filter branch.
    const memberIds = (galleryDetailData.categoryMembers && galleryDetailData.categoryMembers[galleryDetailMode]) || [];
    const seen = new Set();
    return OSU_MODES.flatMap(m => galleryDetailData.collection[m] || [])
        .filter(s => memberIds.includes(s.beatmapset_id) && !seen.has(s.beatmapset_id) && seen.add(s.beatmapset_id));
}

function renderGalleryDetailGrid() {
    const bodyEl = document.getElementById('gallery-detail-body');
    if (!galleryDetailData) return;

    const sets = galleryDetailVisibleSets();
    const totalPages = Math.max(1, Math.ceil(sets.length / GALLERY_DETAIL_PAGE_SIZE));
    if (galleryDetailPage >= totalPages) galleryDetailPage = totalPages - 1;
    if (galleryDetailPage < 0) galleryDetailPage = 0;
    const start = galleryDetailPage * GALLERY_DETAIL_PAGE_SIZE;
    const pageSets = sets.slice(start, start + GALLERY_DETAIL_PAGE_SIZE);

    const cards = pageSets.map(set => {
        const maxDiff = (set.beatmaps || []).reduce((m, b) => Math.max(m, b.difficulty_rating || 0), 0);
        const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/card.jpg`;
        // A category can mix modes, so the badge reads each set's own mode
        // rather than assuming galleryDetailMode — same OSU_MODE_NAMES
        // lookup renderOsuCollection() uses for its own .osu-card-mode-badge.
        const modeKey = OSU_MODE_NAMES[set.mode];
        const modeBadge = modeKey
            ? `<div class="osu-card-mode-badge" title="${escapeHtmlOsu(maxDiff.toFixed(2) + '★')}">${modeIconSvg(modeKey, starRatingColor(maxDiff))}</div>`
            : '';
        return `<a class="gallery-detail-item" href="https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}" target="_blank" rel="noopener noreferrer">
            <img class="gallery-detail-item-bg" src="${coverUrl}" alt="" loading="lazy" onerror="this.style.visibility='hidden';">
            <div class="gallery-detail-item-overlay"></div>
            ${modeBadge}
            <span class="gallery-detail-item-score" id="gd-score-${set.beatmapset_id}" style="display:none;"></span>
            <button class="osu-play-btn" onclick="playOsuPreview(${set.beatmapset_id}, event); event.preventDefault();" title="${t('mappools_preview')}">${icon('play', { filled: true })}</button>
            <div class="gallery-detail-item-info">
                <span class="gallery-detail-item-title">${escapeHtmlOsu(set.title || ('#' + set.beatmapset_id))}</span>
                <span class="gallery-detail-item-stars">${maxDiff.toFixed(2)}⭐</span>
            </div>
        </a>`;
    }).join('');

    const summary = galleryScoresOverlaid ? '<div id="gallery-detail-score-summary" class="gallery-detail-score-summary"></div>' : '';

    let pager = '';
    if (totalPages > 1) {
        const p = galleryDetailPage;
        pager = '<div class="osu-pagination gallery-detail-pager">'
            + `<button class="osu-page-btn" onclick="gotoGalleryDetailPage(0)" ${p === 0 ? 'disabled' : ''}>«</button>`
            + `<button class="osu-page-btn" onclick="gotoGalleryDetailPage(${p - 1})" ${p === 0 ? 'disabled' : ''}>‹</button>`
            + buildPaginationPageButtons(p, totalPages, (i) => `gotoGalleryDetailPage(${i})`)
            + `<button class="osu-page-btn" onclick="gotoGalleryDetailPage(${p + 1})" ${p >= totalPages - 1 ? 'disabled' : ''}>›</button>`
            + `<button class="osu-page-btn" onclick="gotoGalleryDetailPage(${totalPages - 1})" ${p >= totalPages - 1 ? 'disabled' : ''}>»</button>`
            + '</div>';
    }

    bodyEl.innerHTML = `${summary}<div class="gallery-detail-grid">${cards}</div>${pager}`;

    // Score overlay is on (viewer hit "疊上我的成績"): re-paint badges for the
    // cards on this page from the cache, and only fetch the ones not seen yet
    // (a page past the initial run's 100-set cap, or the very first render).
    if (galleryScoresOverlaid) {
        pageSets.forEach(set => applyGalleryScoreBadge(set.beatmapset_id));
        if (galleryDetailScoreTally) renderGalleryScoreSummary(galleryDetailScoreTally);
        if (pageSets.some(s => !galleryDetailScoreCache.has(s.beatmapset_id))) overlayGalleryDetailScores();
    }
}

/* Push one cached score result onto its card, if both exist. */
function applyGalleryScoreBadge(setId) {
    const entry = galleryDetailScoreCache.get(setId);
    const el = document.getElementById(`gd-score-${setId}`);
    if (!entry || !el) return;
    el.className = entry.cls;
    el.textContent = entry.text;
    if (entry.title) el.title = entry.title;
    el.style.display = 'flex';
}

/* "疊上我的成績": for each visible set, look up the logged-in viewer's best
   score on that set's hardest difficulty (v1, chunked — same call the
   collection page's own played-status button uses) and badge each card with
   the rank, plus a grade-breakdown summary line above the grid. */
async function overlayGalleryDetailScores() {
    const user = typeof getLoggedInOsuUser === 'function' ? getLoggedInOsuUser() : null;
    const btn = document.getElementById('gallery-detail-scores-btn');
    if (!user || !user.id || !galleryDetailData) return;

    const sets = galleryDetailVisibleSets();
    // One score lookup per set, one HTTP request each — cap it so a huge
    // all-of-a-mode tab (hundreds of sets) can't fire hundreds of proxy
    // calls. A curated category / mappool-sized tab is well under this.
    const GALLERY_SCORES_CAP = 100;
    const allTargets = sets.map(s => {
        const hardest = (s.beatmaps || []).reduce((a, b) =>
            (b.difficulty_rating || 0) > ((a && a.difficulty_rating) || 0) ? b : a, null);
        return { setId: s.beatmapset_id, beatmapId: hardest && hardest.beatmap_id, mode: s.mode };
    }).filter(x => x.beatmapId != null && x.mode >= 0);
    if (!allTargets.length) return;
    const truncated = allTargets.length > GALLERY_SCORES_CAP;
    const capped = allTargets.slice(0, GALLERY_SCORES_CAP);

    galleryScoresOverlaid = true;
    // The summary line lives above the grid; the grid was rendered before
    // the overlay was turned on, so create the slot now if it's missing
    // (a later grid re-render — e.g. tab switch — keeps it via the flag).
    if (!document.getElementById('gallery-detail-score-summary')) {
        const body = document.getElementById('gallery-detail-body');
        if (body) body.insertAdjacentHTML('afterbegin', '<div id="gallery-detail-score-summary" class="gallery-detail-score-summary"></div>');
    }
    if (btn) { btn.disabled = true; btn.classList.add('checking'); }
    const label = btn && btn.querySelector('span');

    // Only look up the sets on the current page that aren't cached yet — a
    // page turn re-enters here for the newly shown 12. Cache keeps badges
    // and the running tally alive across pages without re-hitting the API.
    const pageStart = galleryDetailPage * GALLERY_DETAIL_PAGE_SIZE;
    const pageIds = new Set(sets.slice(pageStart, pageStart + GALLERY_DETAIL_PAGE_SIZE).map(s => s.beatmapset_id));
    const todo = capped.filter(x => pageIds.has(x.setId) && !galleryDetailScoreCache.has(x.setId));
    const CH = 6;
    for (let i = 0; i < todo.length; i += CH) {
        if (label) label.textContent = t('gallery_scores_checking', { done: i, total: todo.length });
        await Promise.all(todo.slice(i, i + CH).map(async ({ setId, beatmapId, mode }) => {
            try {
                const scores = await osuFetch(`scoreBeatmap=${beatmapId}&scoreUser=${user.id}&m=${mode}`);
                const score = Array.isArray(scores) ? scores[0] : null;
                let entry;
                if (!score) {
                    entry = { cls: 'gallery-detail-item-score osu-play-status unplayed', text: '–', title: '', rank: null };
                } else {
                    const rankClass = OSU_RANK_CLASS[score.rank] || 'f';
                    const isFc = (parseInt(score.countmiss) || 0) === 0;
                    entry = {
                        cls: `gallery-detail-item-score osu-play-status rank-${rankClass}`,
                        text: score.rank || '?',
                        title: `${t(isFc ? 'play_status_fc_title' : 'play_status_played_title', { rank: score.rank || '?' })} · ${(parseFloat(score.pp) || 0).toFixed(0)}pp`,
                        rank: score.rank || null,
                    };
                }
                galleryDetailScoreCache.set(setId, entry);
                applyGalleryScoreBadge(setId);
            } catch (e) {
                console.error('Gallery score check failed for beatmap', beatmapId, e);
            }
        }));
    }

    // Tally over every set checked so far (grows as the viewer pages through).
    const tally = { total: 0, have: 0, ranks: {}, truncated, grandTotal: allTargets.length };
    capped.forEach(x => {
        const e = galleryDetailScoreCache.get(x.setId);
        if (!e) return;
        tally.total++;
        if (e.rank) { tally.have++; tally.ranks[e.rank] = (tally.ranks[e.rank] || 0) + 1; }
    });
    galleryDetailScoreTally = tally;
    renderGalleryScoreSummary(tally);
    if (btn) { btn.disabled = false; btn.classList.remove('checking'); }
    if (label) label.textContent = t('gallery_scores_btn');
}

function renderGalleryScoreSummary(tally) {
    const el = document.getElementById('gallery-detail-score-summary');
    if (!el) return;
    const order = ['XH', 'X', 'SH', 'S', 'A', 'B', 'C', 'D'];
    const disp = { XH: 'SS', X: 'SS', SH: 'S', S: 'S', A: 'A', B: 'B', C: 'C', D: 'D' };
    const merged = {};
    order.forEach(r => { if (tally.ranks[r]) merged[disp[r]] = (merged[disp[r]] || 0) + tally.ranks[r]; });
    const parts = Object.entries(merged).map(([g, n]) =>
        `<span class="gds-grade rank-${(g === 'SS' ? 'ss' : g.toLowerCase())}">${g} ${n}</span>`);
    const note = tally.truncated
        ? `<span class="gds-note">${t('gallery_scores_truncated', { n: tally.total, all: tally.grandTotal })}</span>`
        : '';
    el.innerHTML = `<span class="gds-have">${t('gallery_scores_summary', { have: tally.have, total: tally.total })}</span>${parts.join('')}${note}`;
}

function closeGalleryDetailModal() {
    document.getElementById('gallery-detail-modal').style.display = 'none';
    galleryDetailData = null;
    if (typeof resetGalleryComments === 'function') resetGalleryComments();
}

function downloadGalleryDetailCollection() {
    if (!galleryDetailData) return;
    importPublicCollectionData(galleryDetailData, document.getElementById('gallery-detail-title').textContent);
    closeGalleryDetailModal();
}
