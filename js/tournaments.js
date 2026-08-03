/* ===== Tournaments tab: recent topics from the official osu! "Tournaments"
   subforum (osu.ppy.sh/community/forums/55), via the osu-tournaments Netlify
   function proxy — same OAuth API v2 situation as the News tab, see
   netlify/functions/osu-tournaments.js. These are community-run tournament
   announcement threads, not official Kudosu-run events. ===== */
const OSU_TOURNAMENTS_FUNCTION_URL = '/.netlify/functions/osu-tournaments';
const OSU_TOURNAMENTS_TOPIC_BASE = 'https://osu.ppy.sh/community/forums/topics/';
const OSU_TOURNAMENTS_CACHE_KEY = 'osu_tournaments_cache';

let osuTournamentsLoaded = false;

function ensureTournamentsLoaded() {
    if (!osuTournamentsLoaded) loadOsuTournaments();
}

async function loadOsuTournaments() {
    osuTournamentsLoaded = true;
    const container = document.getElementById('osu-tournaments-list');
    if (!container) return;

    const cached = localStorage.getItem(OSU_TOURNAMENTS_CACHE_KEY);
    if (cached) {
        try {
            renderOsuTournaments(JSON.parse(cached));
        } catch (e) {
            // ignore corrupt cache, network fetch below will repopulate it
        }
    } else {
        container.innerHTML = `<div class="news-loading">${t('updates_loading')}</div>`;
    }

    try {
        const res = await fetch(OSU_TOURNAMENTS_FUNCTION_URL);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const items = (data.topics || []).slice(0, 25);
        localStorage.setItem(OSU_TOURNAMENTS_CACHE_KEY, JSON.stringify(items));
        renderOsuTournaments(items);
    } catch (e) {
        console.error('osu! tournaments load failed:', e);
        if (!cached) container.innerHTML = `<div class="news-empty">${t('updates_load_fail')}</div>`;
    }
}

function renderOsuTournaments(items) {
    const container = document.getElementById('osu-tournaments-list');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = `<div class="news-empty">${t('updates_empty')}</div>`;
        return;
    }
    container.innerHTML = items.map(topic => {
        const dateStr = (topic.updated_at || topic.created_at || '').slice(0, 10);
        const linkUrl = OSU_TOURNAMENTS_TOPIC_BASE + topic.id;
        return `<a class="news-item" href="${linkUrl}" target="_blank" rel="noopener">
            <div class="news-item-body">
                <div class="news-item-header">
                    <span class="news-date">${dateStr}</span>
                    <span class="news-item-stats">&#128172; ${topic.post_count} &#183; &#128065; ${topic.views}</span>
                </div>
                <span class="news-title">${escapeHtmlOsu(topic.title || '')}</span>
            </div>
        </a>`;
    }).join('');
}
