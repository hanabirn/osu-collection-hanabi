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
    if (!publicCollectionsLoaded) loadPublicCollectionsPage(0);
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
        <div class="public-collection-card">
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
            <button class="btn pcc-download-btn" onclick="downloadPublicCollection(${item.id})" title="${t('gallery_download_btn_title')}">⬇ ${t('gallery_download_btn_title')}</button>
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
            body: JSON.stringify({ collection: col }),
        });
        if (res.status === 401) {
            showShareToast(t('publish_login_required'));
            return;
        }
        if (!res.ok) throw new Error('publish failed');
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
        showShareToast(t('unpublish_done'));
        if (publicCollectionsLoaded) loadPublicCollectionsPage(publicCollectionsPage);
    } catch (e) {
        console.error('Unpublish collection failed:', e);
        showShareToast(t('publish_fail'));
    }
}

async function downloadPublicCollection(id) {
    const item = publicCollectionsItems.find(i => String(i.id) === String(id));
    try {
        const res = await fetch(`/.netlify/functions/collections-get?id=${id}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();

        const incomingCount = OSU_MODES.reduce((sum, m) => sum + (data.collection[m] || []).length, 0);
        const name = (item && item.username) || data.username || `#${id}`;
        if (!confirm(t('gallery_import_confirm', { name, n: incomingCount }))) return;

        const added = mergeIncomingCollection(data.collection);
        renderOsuCollection();
        showShareToast(t('osu_share_link_imported', { n: added }));
    } catch (e) {
        console.error('Download public collection failed:', e);
        showShareToast(t('osu_share_link_import_fail'));
    }
}
