/* Shared crawl logic for the catalog metadata index. On Cloudflare it runs
   from GitHub Actions (scripts/catalog-crawl.mjs, .github/workflows/
   catalog-crawl.yml): each run parses and rewrites the whole ~26 MB dataset,
   ~0.5-0.8 s of CPU, and the free Workers plan's 10 ms limit applies to
   Cron Triggers too, so as a Worker cron it was killed on most runs. The
   Netlify copy still uses the scheduled handler (catalog-crawl-cron.js) and
   the manual/backfill HTTP endpoint (catalog-crawl-run.js). Deliberately light: no .osu file fetch and no
   per-map scores call — just page GET /beatmapsets/search and store one
   lean record per beatmapSET.

   State lives in the osu-catalog store:
     - `catalog-state`: { cursors, statusIndex, discoveredCount, sweepCount,
       lastRunAt, lastError }
     - `catalog:all`: array of records keyed (via an in-memory index) by set
       id; upsert absorbs the known ppy cursor-pagination duplicate-result
       bug for free.

   Covers ranked AND loved (CATALOG_STATUSES). They are separate result
   sets, so each keeps its own cursor — sharing one would make each status
   resume from the other's position and skip most of both. Runs alternate
   between statuses so the two advance together; switching only on cursor
   exhaustion would have meant a full pass over ranked's 55k sets before
   the first loved one showed up. An exhausted cursor simply restarts that
   status from the newest sets, which is also how newly-ranked and
   newly-loved ones arrive without separate "check for new" logic.

   One pass covers all four rulesets (no `m=` filter — a set's `modes` array
   records which rulesets its difficulties span). */
const { getOsuToken } = require('./_osu-auth');
const { getCatalogStore } = require('./_blobs-store');
const { setJSONGz, getJSONGz } = require('./_blob-json');
const { primaryArtist, artistKeys } = require('./_artist-keys');
const { writeLeanCatalog, coverageFromState } = require('./_catalog-lean');

const STATE_KEY = 'catalog-state';
const DATASET_KEY = 'catalog:all';
const SEARCH_URL = 'https://osu.ppy.sh/api/v2/beatmapsets/search';

// See _farm-crawl-core.js — leave room in the budget for the dataset write.
const WRITE_RESERVE_MS = 10000;

/* Statuses to sweep, in order. Each gets its own cursor and the crawler
   moves to the next one when the current status runs out of results, so
   both stay current instead of ranked starving loved. */
const CATALOG_STATUSES = ['ranked', 'loved'];

/* Cloudflare allows 50 subrequests per Worker invocation on the free plan,
   and every search page plus the OAuth token request counts. The time
   budget alone does not bound this — fast responses just mean more pages
   inside the same window, which is exactly how a run started failing with
   "Too many subrequests by single Worker invocation" and lost its
   discoveries. Stop well short and let the next run continue from the
   cursor. */
const MAX_SEARCH_PAGES = 40;

async function loadState(store) {
    const state = await store.get(STATE_KEY, { type: 'json' });
    return state || {
        /* One cursor per status: they are independent result sets, so a
           single shared cursor would have each status resume from the
           other's position and skip most of both. */
        cursors: {},
        statusIndex: 0,
        searchCursor: null,   // legacy single-status cursor, migrated on load
        discoveredCount: 0,
        sweepCount: 0,
        lastRunAt: null,
        lastError: null,
        lastOkAt: null,
        consecutiveWriteFails: 0,
    };
}

/* Shrink an API v2 beatmapset object down to the fields the catalog tab
   needs. genre/language are echoed as bare ids (the frontend maps them
   through OSU_GENRES / OSU_LANGUAGES for localized names); fall back to
   *_id when the nested object is absent. */
function toRecord(set) {
    const beatmaps = Array.isArray(set.beatmaps) ? set.beatmaps : [];
    const stars = beatmaps.map(b => b.difficulty_rating || 0).filter(n => n > 0);
    const modes = [...new Set(beatmaps.map(b => b.mode_int).filter(n => n === 0 || n === 1 || n === 2 || n === 3))];
    const genreId = (set.genre && set.genre.id) || set.genre_id || null;
    const languageId = (set.language && set.language.id) || set.language_id || null;
    return {
        id: set.id,
        artist: set.artist || '',
        artist_unicode: set.artist_unicode || set.artist || '',
        title: set.title || '',
        title_unicode: set.title_unicode || set.title || '',
        creator: set.creator || '',
        user_id: set.user_id || null,
        source: (set.source || '').trim(),
        genre_id: genreId,
        language_id: languageId,
        nsfw: !!set.nsfw,
        /* 'ranked' | 'loved' — the catalog covers both now, and they are
           worth telling apart in the UI (loved has no pp and its own
           ranking rules). */
        status: set.status || null,
        ranked_date: set.ranked_date || null,
        bpm: set.bpm || null,
        modes,
        star_min: stars.length ? Math.min(...stars) : null,
        star_max: stars.length ? Math.max(...stars) : null,
        diff_count: beatmaps.length,
        primary_artist: primaryArtist(set.artist || ''),
        artist_keys: artistKeys(set.artist || ''),
    };
}

/* Carries a state written before loved was crawled: its single
   searchCursor belonged to ranked, so hand it over rather than restart
   that sweep from the newest sets again. */
function migrateCursors(state) {
    if (!state.cursors) state.cursors = {};
    if (state.searchCursor && state.cursors.ranked === undefined) {
        state.cursors.ranked = state.searchCursor;
    }
    state.searchCursor = null;
    if (typeof state.statusIndex !== 'number') state.statusIndex = 0;
}

function currentStatus(state) {
    return CATALOG_STATUSES[state.statusIndex % CATALOG_STATUSES.length];
}

async function discoverBatch(state) {
    migrateCursors(state);
    const token = await getOsuToken();
    const status = currentStatus(state);

    const params = new URLSearchParams({ s: status, sort: 'ranked_desc' });
    const cursor = state.cursors[status];
    if (cursor) params.set('cursor_string', cursor);

    const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`beatmapsets/search failed: ${res.status}`);
    const data = await res.json();
    const sets = data.beatmapsets || [];

    state.cursors[status] = data.cursor_string || null;
    /* Exhausted: the next pass over this status starts from the newest sets
       again, which is also how newly-ranked and newly-loved ones arrive. */
    if (!state.cursors[status]) {
        state.sweeps = state.sweeps || {};
        state.sweeps[status] = (state.sweeps[status] || 0) + 1;
        state.sweepCount = (state.sweepCount || 0) + 1;
    }
    return sets;
}

/* `store` defaults to the osu-catalog Blobs/R2 store; the GitHub Actions
   crawler (scripts/catalog-crawl.mjs) passes a file-backed one with the
   same get/set/setJSON interface, then uploads the result to R2 itself. */
async function runCrawlBatch(budgetMs, { store = getCatalogStore() } = {}) {
    const start = Date.now();
    const state = await loadState(store);
    const snapshot = JSON.parse(JSON.stringify(state));
    const dataset = (await getJSONGz(store, DATASET_KEY)) || [];
    const index = new Map(dataset.map((r, i) => [r.id, i]));

    const writeReserve = Math.min(WRITE_RESERVE_MS, Math.floor(budgetMs * 0.4));
    const discoverDeadline = start + (budgetMs - writeReserve);

    let discovered = 0, upserted = 0, error = null;
    let pages = 0;
    try {
        while (Date.now() < discoverDeadline && pages < MAX_SEARCH_PAGES) {
            pages++;
            const sets = await discoverBatch(state);
            if (sets.length === 0) {
                // Cursor exhausted — already reset to null above; stop here
                // and let the next invocation restart from the newest sets.
                break;
            }
            for (const set of sets) {
                const record = toRecord(set);
                const existingIdx = index.get(record.id);
                if (existingIdx === undefined) {
                    record.firstSeenAt = Date.now();
                    dataset.push(record);
                    index.set(record.id, dataset.length - 1);
                    state.discoveredCount++;
                } else {
                    record.firstSeenAt = dataset[existingIdx].firstSeenAt;
                    dataset[existingIdx] = record;
                }
                upserted++;
            }
            discovered += sets.length;
            if (!state.cursors[currentStatus(state)]) break; // exhausted; the next run starts it over
        }
    } catch (err) {
        error = err.message;
    }

    // Dataset write first; roll state back to the pre-run snapshot if it
    // fails, so the run's discoveries aren't silently lost (see
    // _farm-crawl-core.js for the fuller rationale).
    const now = new Date().toISOString();
    let writeOk = true;
    try {
        await setJSONGz(store, DATASET_KEY, dataset);
    } catch (err) {
        writeOk = false;
        error = `dataset write failed: ${err.message}`;
    }

    let savedState;
    if (writeOk) {
        /* Hand the next run the other status. Switching only when a cursor
           runs out would have meant one full pass over ranked — 55k sets,
           the better part of a day — before a single loved set appeared.
           Alternating per run lets both move forward together. */
        state.statusIndex = (state.statusIndex + 1) % CATALOG_STATUSES.length;
        state.lastRunAt = now;
        state.lastOkAt = now;
        state.lastError = error;
        state.consecutiveWriteFails = 0;
        savedState = state;
    } else {
        savedState = {
            ...snapshot,
            lastRunAt: now,
            lastError: error,
            consecutiveWriteFails: (snapshot.consecutiveWriteFails || 0) + 1,
        };
    }
    await store.setJSON(STATE_KEY, savedState);

    /* The browser-facing lean copy (see _catalog-lean.js). Rebuilt even when
       the dataset write failed, so the catalog page's coverage line still
       shows the ⚠ for consecutiveWriteFails. Its own failure only costs
       freshness — the previous copy keeps serving — so it never fails the
       run. */
    let leanOk = true;
    try {
        await writeLeanCatalog(store, dataset, coverageFromState(savedState, dataset.length));
    } catch (err) {
        leanOk = false;
        console.error('catalog lean write failed:', err.message);
    }

    return {
        discovered,
        upserted,
        pages,
        writeOk,
        leanOk,
        datasetSize: dataset.length,
        sweepCount: state.sweepCount,
        cursorActive: !!state.searchCursor,
        error,
    };
}

module.exports = { runCrawlBatch, DATASET_KEY, STATE_KEY };
