/* ===== Tournaments tab: two community tournament sources, each in its own
   date-sorted column (see .tournaments-columns in css/osu.css) =====
   1. Recent topics from the official osu! "Tournaments" subforum
      (osu.ppy.sh/community/forums/55), via the osu-tournaments Netlify
      function proxy — same OAuth API v2 situation as the News tab, see
      netlify/functions/osu-tournaments.js.
   2. Tournaments hosted on wyBin (wybin.xyz), a community tournament
      platform (mostly osu!catch, but covers all 4 modes), via the
      wybin-tournaments Netlify function proxy — see that file for why it's
      proxied and trimmed rather than called directly.
   Neither source is an official Kudosu-run event; both are just
   community-organized tournaments announced/hosted in different places.
   They're normalized into the same shape (normalizeForumTopic /
   normalizeWybinTournament) so both columns share one render function,
   but rendered separately rather than merged into one interleaved list —
   wyBin used to end up buried below dozens of forum posts. ===== */
const OSU_TOURNAMENTS_FUNCTION_URL = '/.netlify/functions/osu-tournaments';
const OSU_TOURNAMENTS_TOPIC_BASE = 'https://osu.ppy.sh/community/forums/topics/';
const OSU_TOURNAMENTS_CACHE_KEY = 'osu_tournaments_cache';

const WYBIN_TOURNAMENTS_FUNCTION_URL = '/.netlify/functions/wybin-tournaments';
const WYBIN_TOURNAMENTS_CACHE_KEY = 'osu_wybin_tournaments_cache';
const WYBIN_TOURNAMENT_BASE = 'https://wybin.xyz/tournaments/';
const WYBIN_UPLOADS_BASE = 'https://wybin.xyz/uploads/tournaments/';
// wyBin's gamemode int: 0=osu,1=taiko,2=catch,3=mania — matches the official
// API's mode order. 4 is "all modes"/mixed-mode events, which has no single
// filter to belong to, so (like forum posts detectTournamentMode() can't
// classify) it only shows under "全部", never under a specific mode tab.
const WYBIN_GAMEMODE_TO_KEY = { 0: 'standard', 1: 'taiko', 2: 'catch', 3: 'mania' };
// Merged list has no pagination (unlike the forum-only list before it, which
// implicitly capped at 25 via the API page size) — cap explicitly so 100+
// years of wyBin history doesn't turn this into an endless scroll.
const MERGED_TOURNAMENTS_LIMIT = 40;

let osuTournamentsLoaded = false;
let osuTournamentsCurrentItems = [];
let osuWybinTournamentsCurrentItems = [];
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

function normalizeForumTopic(topic) {
    return {
        source: 'forum',
        mode: detectTournamentMode(topic.title),
        date: (topic.updated_at || topic.created_at || '').slice(0, 10),
        title: topic.title || '',
        url: OSU_TOURNAMENTS_TOPIC_BASE + topic.id,
        meta: `&#128172; ${topic.post_count} &#183; &#128065; ${topic.views}`,
        thumb: null,
    };
}

function normalizeWybinTournament(item) {
    return {
        source: 'wybin',
        mode: WYBIN_GAMEMODE_TO_KEY[item.gamemode] || null,
        date: item.releaseDate ? new Date(item.releaseDate).toISOString().slice(0, 10) : '',
        title: item.name || '',
        url: WYBIN_TOURNAMENT_BASE + item.slug,
        meta: escapeHtmlOsu(item.tags || item.acronym || ''),
        thumb: item.headerImageThumb ? `${WYBIN_UPLOADS_BASE}${item.slug}/${item.headerImageThumb}` : null,
    };
}

function ensureTournamentsLoaded() {
    if (!osuTournamentsLoaded) loadOsuTournaments();
}

function filterOsuTournamentsByMode(mode, btn) {
    osuTournamentsModeFilter = mode;
    document.querySelectorAll('.tournament-mode-filter .osu-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderOsuTournaments();
}

async function loadOsuTournaments() {
    osuTournamentsLoaded = true;
    const wybinContainer = document.getElementById('osu-tournaments-list-wybin');
    const forumContainer = document.getElementById('osu-tournaments-list-forum');
    if (!wybinContainer || !forumContainer) return;

    const cachedForum = localStorage.getItem(OSU_TOURNAMENTS_CACHE_KEY);
    const cachedWybin = localStorage.getItem(WYBIN_TOURNAMENTS_CACHE_KEY);
    if (cachedForum || cachedWybin) {
        try { if (cachedForum) osuTournamentsCurrentItems = JSON.parse(cachedForum); } catch (e) { /* refetch below repopulates it */ }
        try { if (cachedWybin) osuWybinTournamentsCurrentItems = JSON.parse(cachedWybin); } catch (e) { /* refetch below repopulates it */ }
        renderOsuTournaments();
    } else {
        wybinContainer.innerHTML = `<div class="news-loading">${t('updates_loading')}</div>`;
        forumContainer.innerHTML = `<div class="news-loading">${t('updates_loading')}</div>`;
    }

    const [forumOk, wybinOk] = await Promise.all([
        fetch(OSU_TOURNAMENTS_FUNCTION_URL)
            .then(res => { if (!res.ok) throw new Error('bad response'); return res.json(); })
            .then(data => {
                osuTournamentsCurrentItems = (data.topics || []).slice(0, 25);
                localStorage.setItem(OSU_TOURNAMENTS_CACHE_KEY, JSON.stringify(osuTournamentsCurrentItems));
                return true;
            })
            .catch(e => { console.error('osu! tournaments load failed:', e); return false; }),
        fetch(WYBIN_TOURNAMENTS_FUNCTION_URL)
            .then(res => { if (!res.ok) throw new Error('bad response'); return res.json(); })
            .then(data => {
                osuWybinTournamentsCurrentItems = data.items || [];
                localStorage.setItem(WYBIN_TOURNAMENTS_CACHE_KEY, JSON.stringify(osuWybinTournamentsCurrentItems));
                return true;
            })
            .catch(e => { console.error('wyBin tournaments load failed:', e); return false; }),
    ]);

    if (!forumOk && !cachedForum && !wybinOk && !cachedWybin) {
        wybinContainer.innerHTML = `<div class="news-empty">${t('updates_load_fail')}</div>`;
        forumContainer.innerHTML = `<div class="news-empty">${t('updates_load_fail')}</div>`;
        return;
    }
    renderOsuTournaments();
}

/* Each source gets its own column (see .tournaments-columns in css/osu.css)
   instead of being interleaved into one merged/date-sorted list — wyBin no
   longer ends up buried below a page of forum posts. */
function renderOsuTournaments() {
    const wybinContainer = document.getElementById('osu-tournaments-list-wybin');
    const forumContainer = document.getElementById('osu-tournaments-list-forum');
    if (!wybinContainer || !forumContainer) return;

    renderTournamentColumn(wybinContainer, osuWybinTournamentsCurrentItems.map(normalizeWybinTournament));
    renderTournamentColumn(forumContainer, osuTournamentsCurrentItems.map(normalizeForumTopic));
}

function renderTournamentColumn(container, sourceItems) {
    const filtered = osuTournamentsModeFilter === 'all'
        ? sourceItems
        : sourceItems.filter(item => item.mode === osuTournamentsModeFilter);
    const items = filtered
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, MERGED_TOURNAMENTS_LIMIT);

    if (items.length === 0) {
        container.innerHTML = `<div class="news-empty">${t('updates_empty')}</div>`;
        return;
    }
    container.innerHTML = items.map(item => `
        <a class="news-item" href="${item.url}" target="_blank" rel="noopener">
            ${item.thumb ? `<img class="news-thumb" src="${item.thumb}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <div class="news-item-body">
                <div class="news-item-header">
                    <span class="news-date">${item.date}</span>
                </div>
                <span class="news-title">${escapeHtmlOsu(item.title)}</span>
                ${item.meta ? `<span class="news-item-meta">${item.meta}</span>` : ''}
            </div>
        </a>`).join('');
}
