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
    FARM_PLAYCOUNT_THRESHOLD, FARM_MIN_SAMPLE, farmThresholdForStars,
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

/* "Genuine farm map" heuristic over the beatmap's top-50 leaderboard.
   Model + rationale in _farm-constants.js (v4). In short: score each of the
   top-50 as an "ease weight" in [0,1], take the mean (farmFraction), and
   call it a farm map if that clears a star-rating-sloped threshold — the
   bar loosens as the map gets harder. Gated by playcount and a minimum
   board sample. This is deliberately *not* what osu-pps.com does
   (cross-referencing thousands of players' top-100 lists) — that needs a
   standing database ingesting player score history, which doesn't fit a
   time-boxed cron. */
// Without an explicit x-api-version header, /beatmaps/{id}/scores serves
// osu!'s legacy score shape where `mods` is an array of plain acronym
// strings (e.g. ["HD","DT"]), not the newer `{acronym, settings}` objects —
// this normalizes either shape down to an acronym string.
function modAcronym(m) { return typeof m === 'string' ? m : m.acronym; }
function hasMod(mods, ...names) { return (mods || []).some(m => names.includes(modAcronym(m))); }

// Bumped whenever easeWeight()/fetchFarmSignal's classification logic changes
// in a way that invalidates previously-cached farmSignal values (see
// computeOne — a stale-versioned signal is treated the same as a missing one
// and gets recomputed on the map's next crawl pass, rather than being cached
// wrong forever).
// v3: catch/mania switched from "never a farm map" to a 100%-accuracy ratio.
// v4: whole heuristic replaced — per-score ease weighting + star-sloped
//     threshold; the flat SS-ratio rule was near-backwards for catch/mania.
const FARM_SIGNAL_VERSION = 4;

// FC = full combo. Legacy score shape carries `perfect` (max combo hit);
// fall back to a zero-miss statistics block for either API shape.
function isFC(s) {
    if (s.perfect === true || s.perfect === 1) return true;
    const st = s.statistics || {};
    const miss = st.count_miss != null ? st.count_miss : st.miss;
    return miss === 0;
}
function isSS(s) { return s.rank === 'X' || s.rank === 'XH'; }
function acc(s) { return typeof s.accuracy === 'number' ? s.accuracy : (isSS(s) ? 1 : 0); }

/* How much a single top-50 score reads as a comfortable / farm-style clear,
   in [0,1]. Highest matching clause wins. Mode-specific — what "farmed for
   easy pp" looks like differs sharply by ruleset. */
function easeWeight(mode, s, nmStars) {
    const dt = hasMod(s.mods, 'DT', 'NC');
    const hr = hasMod(s.mods, 'HR');
    const hd = hasMod(s.mods, 'HD');
    const fc = isFC(s);
    const ss = isSS(s);

    if (mode === 'fruits') {
        // catch: HR and DT are both the score/pp mods here, so both read as
        // farm. NM clears barely count unless the map is hard enough that an
        // FC is itself notable ("卡夫的 dt 榜 用 nm 打不算卡手").
        if (dt) return 1.0;
        if (hr && (fc || ss)) return 0.9;
        if (hr) return 0.55;
        if (fc && nmStars >= 5.5) return 0.6;
        if (ss) return 0.5;
        return 0;
    }

    if (mode === 'mania') {
        // mania: mods don't multiply score/pp, so mod composition carries no
        // farm signal here (unlike every other mode) — ignore it entirely.
        // A mania farm map is one whose star rating is inflated vs its real
        // difficulty: the board fills with clears — often FCs — that AREN'T
        // SS, because people chase the pp number without the accuracy (Kloc:
        // "farm maps aren't the SS-able ones"). So the tell is FC-but-well-
        // below-SS; a board topped out by 99.5%+ near-SS plays reads as a
        // legit hard map and scores low.
        const a = acc(s);
        if (fc && a < 0.985) return 0.9;    // FC, clearly not SS territory
        if (fc && a < 0.995) return 0.55;   // FC, near-SS
        if (a >= 0.97 && a < 0.985) return 0.5;   // strong clear, no FC, no SS
        if (fc) return 0.2;                 // FC at 99.5%+: probably just skill
        if (ss) return 0.25;
        return 0;
    }

    // osu! / taiko: DT/NC is the classic pp-cheese. HR is a skill mod here,
    // not a farm mod, so an HR-FC only mildly counts. A no-miss clear with
    // no rate mod only reads as "easy" once the map is genuinely hard.
    if (dt) return 1.0;
    if (hr && fc) return 0.55;
    if (fc && hd) return 0.4;
    if (fc && nmStars >= 7.0) return 0.55;
    if (ss) return 0.35;
    return 0;
}

async function fetchFarmSignal(beatmapId, mode, token, nmStars) {
    const [scoresRes, beatmapRes] = await Promise.all([
        fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores?mode=${mode}&limit=50`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
        fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
    ]);

    let farmFraction = 0, sampleSize = 0;
    if (scoresRes.ok) {
        const scoresData = await scoresRes.json();
        const scores = scoresData.scores || [];
        sampleSize = scores.length;
        if (sampleSize > 0) {
            const sum = scores.reduce((a, s) => a + easeWeight(mode, s, nmStars), 0);
            farmFraction = sum / sampleSize;
        }
    }

    let playcount = 0;
    if (beatmapRes.ok) {
        const beatmapData = await beatmapRes.json();
        playcount = beatmapData.playcount || 0;
        if (!Number.isFinite(nmStars)) nmStars = beatmapData.difficulty_rating;
    }

    const threshold = farmThresholdForStars(mode, nmStars);
    const isFarm = sampleSize >= FARM_MIN_SAMPLE
        && playcount >= FARM_PLAYCOUNT_THRESHOLD
        && farmFraction >= threshold;

    return {
        farmFraction, threshold, nmStars: Number.isFinite(nmStars) ? nmStars : null,
        sampleSize, playcount, isFarm, applicable: true, criterion: 'ease-v4',
        computedAt: Date.now(), signalVersion: FARM_SIGNAL_VERSION,
    };
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
    // aim / speed difficulty per mod combo — feeds farm-maps-list's
    // speedRatio and the practice generator's stream/jump weak dimension.
    // Old records lack these until their next recompute (this runs on every
    // recrawl, same as stars/pp), so coverage fills in gradually.
    const aim = {};
    const speed = {};
    for (const mods of MOD_COMBOS) {
        const diffAttrs = new rosu.Difficulty({ mods }).calculate(map);
        const perf = new rosu.Performance({ mods, accuracy: COMPUTE_ACCURACY });
        stars[modKey(mods)] = diffAttrs.stars;
        pp[modKey(mods)] = perf.calculate(diffAttrs).pp;
        aim[modKey(mods)] = diffAttrs.aim != null ? diffAttrs.aim : null;
        speed[modKey(mods)] = diffAttrs.speed != null ? diffAttrs.speed : null;
    }

    // farmSignal only needs computing once per beatmap — a top-50 leaderboard's
    // mod composition and playcount don't shift fast enough to be worth the
    // extra 2 API calls on every recrawl the way pp/stars (recomputed from the
    // .osu file every time) do. Leave it null on failure so the next recrawl
    // retries rather than caching a false negative. A signalVersion mismatch
    // is treated the same as missing, so fixing a classification bug in
    // fetchFarmSignal self-heals the existing dataset over subsequent crawls
    // instead of leaving old wrong values cached forever.
    let farmSignal = existingRecord && existingRecord.farmSignal;
    if (!farmSignal || farmSignal.signalVersion !== FARM_SIGNAL_VERSION) {
        try {
            farmSignal = await fetchFarmSignal(item.beatmap_id, mode, token, stars[modKey('')]);
        } catch (err) {
            farmSignal = null;
        }
    }

    return { ...item, stars, pp, aim, speed, farmSignal };
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
