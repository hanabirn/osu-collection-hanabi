/* Shared discover/compute crawl logic for the Farm Maps dataset, used by
   both the scheduled cron handler (farm-crawl-cron.js) and the manual/
   backfill HTTP endpoint (farm-crawl-run.js) — see netlify.toml for the
   schedule declaration and both functions' rosu-pp-js wasm included_files.

   Crawl state per mode lives in the farm-maps Blobs store under
   `crawl-state:{mode}`: { searchCursor, pendingQueue, discoveredCount,
   computedCount, totalKnown, lastRunAt, lastError }. Two phases, chosen per
   invocation by whether pendingQueue has items:
     - discover: page through GET /beatmapsets/search (s=ranked, sort=
       ranked_desc — newest-ranked first, since farm-map relevance skews
       toward current meta and this is what should be covered soonest while
       the dataset is still partial), enqueue difficulties >= STAR_FLOOR.
     - compute: pop from pendingQueue, fetch the raw .osu file (same source
       osu-pp.js uses), run rosu-pp-js for MOD_COMBOS, upsert into
       `dataset:{mode}` keyed by beatmap_id — upsert (not append) absorbs
       the known ppy/osu-web cursor-pagination duplicate-result bug for
       free, no separate dedup pass needed.
   Everything is time-boxed by budgetMs so a single invocation fits inside
   Netlify's scheduled-function execution window with headroom. When the
   search cursor is exhausted (no more results for this mode) it resets to
   null, so the next run naturally restarts from the newest maps again
   rather than getting stuck — that also means newly-ranked maps get
   picked up over time without needing separate "check for new maps"
   logic. */
const rosu = require('rosu-pp-js');
const { getOsuToken } = require('./_osu-auth');
const { getFarmMapsStore } = require('./_blobs-store');
const { STAR_FLOOR, MOD_COMBOS, COMPUTE_ACCURACY, MODE_NUM, MODES } = require('./_farm-constants');

function stateKey(mode) { return `crawl-state:${mode}`; }
function datasetKey(mode) { return `dataset:${mode}`; }
function modKey(mods) { return mods || 'NM'; }

async function loadState(store, mode) {
    const state = await store.get(stateKey(mode), { type: 'json' });
    return state || {
        searchCursor: null,
        pendingQueue: [],
        discoveredCount: 0,
        computedCount: 0,
        totalKnown: 0,
        lastRunAt: null,
        lastError: null,
    };
}

async function discoverBatch(mode, state) {
    const token = await getOsuToken();
    const params = new URLSearchParams({ s: 'ranked', m: String(MODE_NUM[mode]), sort: 'ranked_desc' });
    if (state.searchCursor) params.set('cursor_string', state.searchCursor);

    const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/search?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`beatmapsets/search failed: ${res.status}`);
    const data = await res.json();
    const sets = data.beatmapsets || [];
    if (typeof data.total === 'number') state.totalKnown = data.total;

    const modeNum = MODE_NUM[mode];
    for (const set of sets) {
        for (const b of (set.beatmaps || [])) {
            // beatmapsets/search?m={mode} filters by beatmapSET, not by
            // individual difficulty — a set with both e.g. osu!std and taiko
            // diffs matches the search either way, and `beatmaps` lists every
            // difficulty in the set regardless of ruleset. Without this
            // check, the "other" ruleset's diffs (mode_int !== modeNum) get
            // crawled and PP-computed as if they were native to this mode,
            // which is wrong — confirmed by finding actual osu!std beatmaps
            // ranked #1 in the taiko dataset with implausibly high "taiko" pp.
            if (b.mode_int !== modeNum) continue;
            if ((b.difficulty_rating || 0) < STAR_FLOOR) continue;
            state.pendingQueue.push({
                beatmap_id: b.id,
                beatmapset_id: set.id,
                artist: set.artist,
                title: set.title,
                creator: set.creator,
                version: b.version,
                bpm: b.bpm,
                total_length: b.total_length,
                hit_length: b.hit_length,
                cs: b.cs, ar: b.ar, od: b.accuracy, hp: b.drain,
                ranked_date: set.ranked_date,
            });
            state.discoveredCount++;
        }
    }

    state.searchCursor = data.cursor_string || null;
    return sets.length;
}

async function computeOne(item) {
    const res = await fetch(`https://osu.ppy.sh/osu/${item.beatmap_id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu-collection-hanabi.netlify.app/)' },
    });
    const text = await res.text();
    if (!res.ok || !text) throw new Error(`beatmap file fetch failed for ${item.beatmap_id}`);

    const map = new rosu.Beatmap(text);
    const stars = {};
    const pp = {};
    for (const mods of MOD_COMBOS) {
        const diffAttrs = new rosu.Difficulty({ mods }).calculate(map);
        const perf = new rosu.Performance({ mods, accuracy: COMPUTE_ACCURACY });
        stars[modKey(mods)] = diffAttrs.stars;
        pp[modKey(mods)] = perf.calculate(diffAttrs).pp;
    }

    return { ...item, stars, pp };
}

async function runCrawlBatch(mode, budgetMs) {
    const start = Date.now();
    const store = getFarmMapsStore();
    const state = await loadState(store, mode);
    const dataset = (await store.get(datasetKey(mode), { type: 'json' })) || [];
    const index = new Map(dataset.map((r, i) => [r.beatmap_id, i]));

    let discovered = 0, computed = 0, error = null;
    try {
        while (Date.now() - start < budgetMs) {
            if (state.pendingQueue.length === 0) {
                const got = await discoverBatch(mode, state);
                discovered += got;
                if (got === 0) break; // exhausted for now — cursor already reset to null above
                continue;
            }
            const item = state.pendingQueue.shift();
            const record = await computeOne(item);
            const existingIdx = index.get(record.beatmap_id);
            if (existingIdx === undefined) {
                record.firstSeenAt = Date.now();
                dataset.push(record);
                index.set(record.beatmap_id, dataset.length - 1);
            } else {
                // computeOne() never sets firstSeenAt itself — preserve the
                // original value here or a recompute would wipe it out.
                record.firstSeenAt = dataset[existingIdx].firstSeenAt;
                dataset[existingIdx] = record;
            }
            state.computedCount++;
            computed++;
        }
    } catch (err) {
        error = err.message;
    }

    state.lastRunAt = new Date().toISOString();
    state.lastError = error;
    await store.setJSON(stateKey(mode), state);
    await store.setJSON(datasetKey(mode), dataset);

    return { mode, discovered, computed, datasetSize: dataset.length, queueLength: state.pendingQueue.length, error };
}

module.exports = { runCrawlBatch, MOD_COMBOS, STAR_FLOOR, MODE_NUM, MODES };
