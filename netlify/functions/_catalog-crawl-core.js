/* Shared crawl logic for the ranked-catalog metadata index, used by the
   scheduled handler (catalog-crawl-cron.js) and the manual/backfill HTTP
   endpoint (catalog-crawl-run.js). Deliberately much lighter than the Farm
   Maps crawler (_farm-crawl-core.js): no rosu-pp, no .osu file fetch, no
   per-map scores call — just page GET /beatmapsets/search and store one lean
   record per beatmapSET.

   State lives in the osu-catalog Blobs store:
     - `catalog-state`: { searchCursor, discoveredCount, sweepCount,
       lastRunAt, lastError }
     - `catalog:all`: array of records keyed (via an in-memory index) by set
       id; upsert absorbs the known ppy cursor-pagination duplicate-result
       bug for free.

   One pass covers all four rulesets (no `m=` filter — a set's `modes` array
   records which rulesets its difficulties span). When the search cursor is
   exhausted it resets to null and sweepCount is bumped, so the next run
   restarts from the newest ranked sets — which also means newly-ranked sets
   get picked up over time without separate "check for new" logic. */
const { getOsuToken } = require('./_osu-auth');
const { getCatalogStore } = require('./_blobs-store');
const { setJSONGz, getJSONGz } = require('./_blob-json');
const { primaryArtist, artistKeys } = require('./_artist-keys');

const STATE_KEY = 'catalog-state';
const DATASET_KEY = 'catalog:all';
const SEARCH_URL = 'https://osu.ppy.sh/api/v2/beatmapsets/search';

// See _farm-crawl-core.js — leave room in the budget for the dataset write.
const WRITE_RESERVE_MS = 10000;

async function loadState(store) {
    const state = await store.get(STATE_KEY, { type: 'json' });
    return state || {
        searchCursor: null,
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

async function discoverBatch(state) {
    const token = await getOsuToken();
    const params = new URLSearchParams({ s: 'ranked', sort: 'ranked_desc' });
    if (state.searchCursor) params.set('cursor_string', state.searchCursor);

    const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`beatmapsets/search failed: ${res.status}`);
    const data = await res.json();
    const sets = data.beatmapsets || [];

    state.searchCursor = data.cursor_string || null;
    if (!state.searchCursor) state.sweepCount = (state.sweepCount || 0) + 1;
    return sets;
}

async function runCrawlBatch(budgetMs) {
    const start = Date.now();
    const store = getCatalogStore();
    const state = await loadState(store);
    const snapshot = JSON.parse(JSON.stringify(state));
    const dataset = (await getJSONGz(store, DATASET_KEY)) || [];
    const index = new Map(dataset.map((r, i) => [r.id, i]));

    const writeReserve = Math.min(WRITE_RESERVE_MS, Math.floor(budgetMs * 0.4));
    const discoverDeadline = start + (budgetMs - writeReserve);

    let discovered = 0, upserted = 0, error = null;
    try {
        while (Date.now() < discoverDeadline) {
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
            if (!state.searchCursor) break; // finished a full sweep this run
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

    if (writeOk) {
        state.lastRunAt = now;
        state.lastOkAt = now;
        state.lastError = error;
        state.consecutiveWriteFails = 0;
        await store.setJSON(STATE_KEY, state);
    } else {
        await store.setJSON(STATE_KEY, {
            ...snapshot,
            lastRunAt: now,
            lastError: error,
            consecutiveWriteFails: (snapshot.consecutiveWriteFails || 0) + 1,
        });
    }

    return {
        discovered,
        upserted,
        writeOk,
        datasetSize: dataset.length,
        sweepCount: state.sweepCount,
        cursorActive: !!state.searchCursor,
        error,
    };
}

module.exports = { runCrawlBatch, DATASET_KEY, STATE_KEY };
