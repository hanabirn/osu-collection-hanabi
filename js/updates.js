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
