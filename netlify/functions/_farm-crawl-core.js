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
const {
    STAR_FLOOR, MOD_COMBOS, COMPUTE_ACCURACY, MODE_NUM, MODES,
    FARM_DT_RATIO_THRESHOLD, FARM_PLAYCOUNT_THRESHOLD,
} = require('./_farm-constants');

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

/* "Genuine farm map" heuristic: what fraction of the beatmap's top-50
   leaderboard was set with DT/NC (a cheap proxy for "the community is
   abusing this map for pp, not just playing it at face value"), gated by
   playcount so a handful of DT scores on a barely-played map doesn't count
   as a real signal. Both thresholds are the site owner's judgment call,
   not derived from anything (see FARM_DT_RATIO_THRESHOLD/FARM_PLAYCOUNT_
   THRESHOLD in _farm-constants.js). This is deliberately *not* the same
   thing osu-pps.com does (cross-referencing thousands of players' top-100
   lists to see how many have this map in them) — that needs a standing
   database continuously ingesting player score history, which doesn't fit
   a time-boxed Netlify cron function. */
async function fetchFarmSignal(beatmapId, mode, token) {
    // mania has no score-multiplying mods the way std/taiko/catch do — DT in
    // mania is purely a personal scroll-speed/readability preference, not a
    // pp-farming signal, so a high DT ratio there means nothing. Skip the DT
    // check entirely for mania and never classify a mania map as a farm map
    // through this heuristic (playcount alone isn't a strong enough signal).
    if (mode === 'mania') {
        return { dtRatio: 0, sampleSize: 0, playcount: 0, isFarm: false, applicable: false, computedAt: Date.now() };
    }

    const [scoresRes, beatmapRes] = await Promise.all([
        fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores?mode=${mode}&limit=50`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
        fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
    ]);

    let dtRatio = 0, sampleSize = 0;
    if (scoresRes.ok) {
        const scoresData = await scoresRes.json();
        const scores = scoresData.scores || [];
        sampleSize = scores.length;
        if (sampleSize > 0) {
            const dtCount = scores.filter(s => (s.mods || []).some(m => m.acronym === 'DT' || m.acronym === 'NC')).length;
            dtRatio = dtCount / sampleSize;
        }
    }

    let playcount = 0;
    if (beatmapRes.ok) {
        const beatmapData = await beatmapRes.json();
        playcount = beatmapData.playcount || 0;
    }

    const isFarm = dtRatio >= FARM_DT_RATIO_THRESHOLD && playcount >= FARM_PLAYCOUNT_THRESHOLD;
    return { dtRatio, sampleSize, playcount, isFarm, applicable: true, computedAt: Date.now() };
}

async function computeOne(item, mode, existingRecord, token) {
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

    // farmSignal only needs computing once per beatmap — a top-50 leaderboard's
    // mod composition and playcount don't shift fast enough to be worth the
    // extra 2 API calls on every recrawl the way pp/stars (recomputed from the
    // .osu file every time) do. Leave it null on failure so the next recrawl
    // retries rather than caching a false negative.
    let farmSignal = existingRecord && existingRecord.farmSignal;
    if (!farmSignal) {
        try {
            farmSignal = await fetchFarmSignal(item.beatmap_id, mode, token);
        } catch (err) {
            farmSignal = null;
        }
    }

    return { ...item, stars, pp, farmSignal };
}

async function runCrawlBatch(mode, budgetMs) {
    const start = Date.now();
    const store = getFarmMapsStore();
    const state = await loadState(store, mode);
    const dataset = (await store.get(datasetKey(mode), { type: 'json' })) || [];
    const index = new Map(dataset.map((r, i) => [r.beatmap_id, i]));

    let discovered = 0, computed = 0, error = null;
    try {
        const token = await getOsuToken();
        while (Date.now() - start < budgetMs) {
            if (state.pendingQueue.length === 0) {
                const got = await discoverBatch(mode, state);
                discovered += got;
                if (got === 0) break; // exhausted for now — cursor already reset to null above
                continue;
            }
            const item = state.pendingQueue.shift();
            const existingIdx = index.get(item.beatmap_id);
            const existingRecord = existingIdx !== undefined ? dataset[existingIdx] : null;
            const record = await computeOne(item, mode, existingRecord, token);
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
