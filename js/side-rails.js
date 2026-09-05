/* ===== Side rails (desktop-only, >=1700px) =====
   The centered content column leaves big empty gutters on a wide monitor —
   rather than pure decoration there (the old .world-globe), these two
   panels show real, changing site content: a merged "what's happening"
   feed (chat + gallery) on the left, a few honest site-wide numbers on the
   right. Both reuse existing public read endpoints (chat-list.js,
   collections-list.js, catalog-list.js, wc-mappools-list.js,
   farm-maps-list.js) — no new backend needed. Only fetched once the rails
   are actually visible (matchMedia-gated), so narrower viewports never pay
   for these calls at all. See css/base.css .side-rail for the layout math
   that keeps them clear of the content column at any width. */
const SIDE_RAIL_MIN_WIDTH_MQ = window.matchMedia('(min-width: 1700px)');
let sideRailsLoaded = false;

function initSideRails() {
    if (SIDE_RAIL_MIN_WIDTH_MQ.matches) loadSideRails();
    else SIDE_RAIL_MIN_WIDTH_MQ.addEventListener('change', function onFirstMatch(e) {
        if (!e.matches) return;
        loadSideRails();
        SIDE_RAIL_MIN_WIDTH_MQ.removeEventListener('change', onFirstMatch);
    });
}

function loadSideRails() {
    if (sideRailsLoaded) return;
    sideRailsLoaded = true;
    loadSideRailActivity();
    loadSideRailStats();
}

function sideRailTimeAgo(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return t('side_rail_just_now');
    if (mins < 60) return t('side_rail_minutes_ago', { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('side_rail_hours_ago', { n: hours });
    return t('side_rail_days_ago', { n: Math.floor(hours / 24) });
}

async function loadSideRailActivity() {
    const listEl = document.getElementById('side-rail-activity-list');
    if (!listEl) return;
    try {
        const [chatData, galleryData] = await Promise.all([
            fetch('/.netlify/functions/chat-list').then(r => r.ok ? r.json() : { messages: [] }).catch(() => ({ messages: [] })),
            fetch('/.netlify/functions/collections-list?sort=recent&page=0').then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        ]);

        const chatItems = (chatData.messages || []).slice(-4).map(m => ({
            time: m.createdAt,
            html: `${icon('messageCircle', { extraClass: 'icon-label-gap' })}<b>${escapeHtmlOsu(m.authorUsername)}</b>：${escapeHtmlOsu(m.content)}`,
            onclick: "switchTab('chat')",
        }));
        const galleryItems = (galleryData.items || []).slice(0, 3).map(c => ({
            time: c.updatedAt,
            html: `${icon('globe', { extraClass: 'icon-label-gap' })}<b>${escapeHtmlOsu(c.username || ('#' + c.id))}</b> ${t('side_rail_published_collection')}`,
            onclick: `switchTab('public-collections');setTimeout(()=>openGalleryDetailModal(${c.id}),50)`,
        }));

        const merged = [...chatItems, ...galleryItems]
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, 6);

        listEl.innerHTML = merged.length ? merged.map(it => `
            <div class="side-rail-item" onclick="${it.onclick}">
                <div class="side-rail-item-body">
                    <div class="side-rail-item-text">${it.html}</div>
                    <div class="side-rail-item-time">${sideRailTimeAgo(it.time)}</div>
                </div>
            </div>`).join('') : `<p class="osu-empty">${t('side_rail_activity_empty')}</p>`;
    } catch (e) {
        console.error('Side rail activity load failed:', e);
    }
}

async function loadSideRailStats() {
    const gridEl = document.getElementById('side-rail-stats-grid');
    if (!gridEl) return;
    try {
        const [catalogData, mappoolsData, farmData, galleryData] = await Promise.all([
            fetch('/.netlify/functions/catalog-list?limit=1').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/.netlify/functions/wc-mappools-list').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/.netlify/functions/farm-maps-list?page=0').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/.netlify/functions/collections-list?sort=recent&page=0').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        const mappoolTotal = mappoolsData && Array.isArray(mappoolsData.editions)
            ? mappoolsData.editions.reduce((sum, e) => sum + (e.mapCount || 0), 0)
            : null;

        const stats = [
            { value: catalogData && catalogData.total, label: t('side_rail_stat_catalog') },
            { value: mappoolTotal, label: t('side_rail_stat_mappools') },
            { value: farmData && farmData.total, label: t('side_rail_stat_farm') },
            { value: galleryData && galleryData.total, label: t('side_rail_stat_gallery') },
        ];
        gridEl.innerHTML = stats.map(s => `
            <div class="osu-stat">
                <div class="osu-stat-value">${s.value != null ? s.value.toLocaleString() : '—'}</div>
                <div class="osu-stat-label">${s.label}</div>
            </div>`).join('');
    } catch (e) {
        console.error('Side rail stats load failed:', e);
    }
}
