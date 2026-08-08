/* ===== Updates tab: official osu! news feed, via the osu-news Netlify
   function proxy (osu!'s news listing needs OAuth API v2 access, unlike the
   legacy-API-v1-keyed osu.js proxy — see netlify/functions/osu-news.js). ===== */
const OSU_NEWS_FUNCTION_URL = '/.netlify/functions/osu-news';
const OSU_NEWS_PAGE_BASE = 'https://osu.ppy.sh/home/news/';
const OSU_NEWS_CACHE_KEY = 'osu_news_cache';

let osuUpdatesLoaded = false;

function ensureUpdatesLoaded() {
    if (!osuUpdatesLoaded) loadOsuNews();
}

async function loadOsuNews() {
    osuUpdatesLoaded = true;
    const container = document.getElementById('osu-news-list');
    if (!container) return;

    const cached = localStorage.getItem(OSU_NEWS_CACHE_KEY);
    if (cached) {
        try {
            renderOsuNews(JSON.parse(cached));
        } catch (e) {
            // ignore corrupt cache, network fetch below will repopulate it
        }
    } else {
        container.innerHTML = `<div class="news-loading">${t('updates_loading')}</div>`;
    }

    try {
        const res = await fetch(OSU_NEWS_FUNCTION_URL);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const items = (data.news_posts || []).slice(0, 20);
        localStorage.setItem(OSU_NEWS_CACHE_KEY, JSON.stringify(items));
        renderOsuNews(items);
    } catch (e) {
        console.error('osu! news load failed:', e);
        if (!cached) container.innerHTML = `<div class="news-empty">${t('updates_load_fail')}</div>`;
    }
}

function renderOsuNews(items) {
    const container = document.getElementById('osu-news-list');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = `<div class="news-empty">${t('updates_empty')}</div>`;
        return;
    }
    container.innerHTML = items.map(n => {
        const dateStr = (n.published_at || '').slice(0, 10);
        const linkUrl = OSU_NEWS_PAGE_BASE + n.slug;
        const imageUrl = n.first_image ? (n.first_image.startsWith('http') ? n.first_image : 'https://osu.ppy.sh' + n.first_image) : '';
        return `<a class="news-item" href="${linkUrl}" target="_blank" rel="noopener">
            ${imageUrl ? `<img class="news-thumb" src="${imageUrl}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="news-item-body">
                <div class="news-item-header">
                    <span class="news-date">${dateStr}</span>
                </div>
                <span class="news-title">${escapeHtmlOsu(n.title || '')}</span>
            </div>
        </a>`;
    }).join('');
}

function escapeHtmlOsu(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ===== Mapper tracking — same lightweight localStorage pattern as tracked
   players (js/osu.js), just for "has this mapper ranked anything new"
   instead of PP. Tracked by username directly (get_beatmaps' u=&type=string
   filter accepts it), so there's no separate lookup step first — see
   js/notifications.js's checkTrackedMappers() for the actual polling. */
const TRACKED_MAPPERS_KEY = 'osu_tracked_mappers';

function getTrackedMappers() {
    try { return JSON.parse(localStorage.getItem(TRACKED_MAPPERS_KEY)) || []; }
    catch { return []; }
}
function saveTrackedMappers(list) {
    localStorage.setItem(TRACKED_MAPPERS_KEY, JSON.stringify(list));
}

function trackMapperFromInput() {
    const input = document.getElementById('mapper-track-input');
    const name = input.value.trim();
    if (!name) return;
    const list = getTrackedMappers();
    if (list.some(m => m.name.toLowerCase() === name.toLowerCase())) {
        showShareToast(t('mapper_already_tracked'));
        return;
    }
    list.push({ name, lastMaxApprovedDate: null, knownGraveyardIds: null, knownLovedIds: null });
    saveTrackedMappers(list);
    input.value = '';
    showShareToast(t('mapper_track_done'));
    renderTrackedMappersList();
}

function untrackMapperByName(name) {
    saveTrackedMappers(getTrackedMappers().filter(m => m.name !== name));
    renderTrackedMappersList();
}

function renderTrackedMappersList() {
    const panel = document.getElementById('tracked-mappers-panel');
    if (!panel) return;
    const list = getTrackedMappers();
    if (list.length === 0) {
        panel.innerHTML = `<div class="tracked-players-empty">${t('tracked_mappers_empty')}</div>`;
        return;
    }
    panel.innerHTML = `<div class="tracked-players-list">${list.map(m => `
        <div class="tracked-player-card tracked-mapper-card">
            <span class="tracked-player-name">${icon('palette', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(m.name)}</span>
            <button class="tracked-player-remove" onclick="untrackMapperByName(decodeURIComponent('${encodeURIComponent(m.name)}'))" title="${t('untrack_player_btn')}">${icon('x')}</button>
        </div>`).join('')}
    </div>`;
}
