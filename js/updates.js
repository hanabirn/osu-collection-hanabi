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
        // API v2's news listing already includes a short excerpt per post
        // (`preview`) — no extra fetch needed to show more than the title.
        return `<a class="news-item" href="${linkUrl}" target="_blank" rel="noopener">
            ${imageUrl ? `<img class="news-thumb" src="${imageUrl}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="news-item-body">
                <div class="news-item-header">
                    <span class="news-date">${dateStr}</span>
                </div>
                <span class="news-title">${escapeHtmlOsu(n.title || '')}</span>
                ${n.preview ? `<span class="news-summary">${escapeHtmlOsu(n.preview)}</span>` : ''}
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
   filter accepts it), so the ranked/graveyard/loved polling itself needs no
   id lookup — see js/notifications.js's checkTrackedMappers(). The id/
   country stored alongside the name are only for the card's avatar+flag+
   profile-link, resolved via a v1 get_user lookup (same osuFetch('u=...')
   call renderTrackedPlayersList's entries already come from). Entries
   tracked before this lookup existed just have id/country as null;
   checkTrackedMappers() backfills them lazily on its own periodic pass. */
const TRACKED_MAPPERS_KEY = 'osu_tracked_mappers';

function getTrackedMappers() {
    try { return JSON.parse(localStorage.getItem(TRACKED_MAPPERS_KEY)) || []; }
    catch { return []; }
}
function saveTrackedMappers(list) {
    localStorage.setItem(TRACKED_MAPPERS_KEY, JSON.stringify(list));
}

async function trackMapperFromInput() {
    const input = document.getElementById('mapper-track-input');
    const btn = input && input.nextElementSibling;
    const name = input.value.trim();
    if (!name) return;
    const list = getTrackedMappers();
    if (list.some(m => m.name.toLowerCase() === name.toLowerCase())) {
        showShareToast(t('mapper_already_tracked'));
        return;
    }

    if (btn) btn.disabled = true;
    let id = null, country = null, canonicalName = name;
    try {
        const users = await osuFetch(`u=${encodeURIComponent(name)}&type=string`);
        const u = Array.isArray(users) ? users[0] : null;
        if (!u) {
            showShareToast(t('mapper_not_found'));
            return;
        }
        id = u.user_id;
        country = u.country || null;
        canonicalName = u.username;
    } catch (e) {
        console.error('Mapper lookup failed:', e);
        showShareToast(t('mapper_not_found'));
        return;
    } finally {
        if (btn) btn.disabled = false;
    }

    list.push({ name: canonicalName, id, country, lastMaxApprovedDate: null, knownGraveyardIds: null, knownLovedIds: null });
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
        <div class="tracked-player-card tracked-mapper-card" ${m.id ? `onclick="window.open('https://osu.ppy.sh/users/${m.id}','_blank')"` : ''}>
            ${m.id ? `
            <div class="avatar-with-flag">
                <img class="tracked-player-avatar" src="${osuAvatarUrl(m.id)}" alt="" onerror="this.style.visibility='hidden';">
                ${m.country ? `<img class="avatar-flag-badge" src="${flagUrl(m.country)}" alt="" onerror="this.style.display='none';">` : ''}
            </div>` : ''}
            <span class="tracked-player-name">${icon('palette', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(m.name)}</span>
            <button class="tracked-player-remove" onclick="event.stopPropagation();untrackMapperByName(decodeURIComponent('${encodeURIComponent(m.name)}'))" title="${t('untrack_player_btn')}">${icon('x')}</button>
        </div>`).join('')}
    </div>`;
}
