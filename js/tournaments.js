/* ===== Tournaments tab: recent topics from the official osu! "Tournaments"
   subforum (osu.ppy.sh/community/forums/55), via the osu-tournaments Netlify
   function proxy — same OAuth API v2 situation as the News tab, see
   netlify/functions/osu-tournaments.js. These are community-run tournament
   announcement threads, not official Kudosu-run events. ===== */
const OSU_TOURNAMENTS_FUNCTION_URL = '/.netlify/functions/osu-tournaments';
const OSU_TOURNAMENTS_TOPIC_BASE = 'https://osu.ppy.sh/community/forums/topics/';
const OSU_TOURNAMENTS_CACHE_KEY = 'osu_tournaments_cache';

let osuTournamentsLoaded = false;
let osuTournamentsCurrentItems = [];
let osuTournamentsModeFilter = 'all';

/* Best-effort mode detection from the topic title — the forum API gives us
   no structured mode field, so this looks for the bracket tags tournament
   hosts conventionally prefix their thread titles with (e.g. "[osu!] 5WC",
   "[Taiko] ..."). Titles that don't match any tag only show under "All". */
/* Order matters: checked top to bottom, first match wins. Tags like
   "[osu!mania 4k]" contain "osu!" as a substring of the mania tag, so the
   more specific mania/taiko/catch checks must run before the loose
   osu!/std/standard one or they'd never get a chance to match. */
const TOURNAMENT_MODE_PATTERNS = [
    ['mania', /\bmania\b/i],
    ['taiko', /\btaiko\b/i],
    ['catch', /\b(catch|ctb)\b/i],
    ['standard', /\[?\s*(osu!?|std|standard)\s*\]?/i],
];

function detectTournamentMode(title) {
    if (!title) return null;
    const bracketTag = title.match(/^\s*\[([^\]]+)\]/);
    const haystack = bracketTag ? bracketTag[1] : title;
    for (const [mode, pattern] of TOURNAMENT_MODE_PATTERNS) {
        if (pattern.test(haystack)) return mode;
    }
    return null;
}

function ensureTournamentsLoaded() {
    if (!osuTournamentsLoaded) loadOsuTournaments();
}

function filterOsuTournamentsByMode(mode, btn) {
    osuTournamentsModeFilter = mode;
    document.querySelectorAll('.tournament-mode-filter .osu-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderOsuTournaments(osuTournamentsCurrentItems);
}

async function loadOsuTournaments() {
    osuTournamentsLoaded = true;
    const container = document.getElementById('osu-tournaments-list');
    if (!container) return;

    const cached = localStorage.getItem(OSU_TOURNAMENTS_CACHE_KEY);
    if (cached) {
        try {
            osuTournamentsCurrentItems = JSON.parse(cached);
            renderOsuTournaments(osuTournamentsCurrentItems);
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
        osuTournamentsCurrentItems = items;
        renderOsuTournaments(items);
    } catch (e) {
        console.error('osu! tournaments load failed:', e);
        if (!cached) container.innerHTML = `<div class="news-empty">${t('updates_load_fail')}</div>`;
    }
}

function renderOsuTournaments(allItems) {
    const container = document.getElementById('osu-tournaments-list');
    if (!container) return;
    const items = osuTournamentsModeFilter === 'all'
        ? allItems
        : (allItems || []).filter(topic => detectTournamentMode(topic.title) === osuTournamentsModeFilter);
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
