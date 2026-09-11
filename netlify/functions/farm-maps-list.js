/* Public, filtered/sorted/paginated listing over the precomputed Farm Maps
   dataset — modeled directly on collections-list.js. No auth: this is a
   read-only view over server-computed PP data, not per-caller state.
   The dataset itself is built by farm-crawl-cron.js / farm-crawl-run.js
   (see _farm-crawl-core.js) and is necessarily partial/growing rather than
   a complete ranked-pool snapshot — the `coverage` block in the response
   lets the frontend say so honestly instead of implying completeness. */
const { getFarmMapsStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');
const {
    MOD_COMBOS, MODE_NUM,
    FARM_MIN_SAMPLE, farmThresholdForStars, farmPlaycountFloor,
} = require('./_farm-constants');

const PAGE_SIZE = 20;
const MODS_SET = new Set(MOD_COMBOS.map(m => m || 'NM'));

/* In-process cache of the parsed dataset array, reused across invocations
   while the function container stays warm. The multi-MB read + JSON.parse is
   the slow part of this endpoint; the Discord bot's /farm (which reads twice
   per press) and the .osdb export loop were timing out on it. `crawl-state`
   is still read fresh every call, so `coverage` never lags even when this is
   up to DS_CACHE_TTL_MS stale. One mode held at a time. */
const DS_CACHE_TTL_MS = 60_000;
let _dsCache = { mode: null, at: 0, dataset: null };

async function loadDataset(store, mode) {
    const now = Date.now();
    if (_dsCache.dataset && _dsCache.mode === mode && now - _dsCache.at < DS_CACHE_TTL_MS) {
        return _dsCache.dataset;
    }
    const dataset = (await getJSONGz(store, `dataset:${mode}`)) || [];
    _dsCache = { mode, at: now, dataset };
    return dataset;
}

/* Whether a record counts as a farm map, decided HERE at read time rather
   than trusting the crawl-time farmSignal.isFarm snapshot — so retuning
   FARM_THRESHOLD_CURVE in _farm-constants.js takes effect immediately across
   the whole dataset instead of waiting on a full signal recompute. The
   expensive part (fetching the top-50 board -> farmFraction) stays cached in
   the record; only the cheap threshold comparison is re-run.

   Records from before the v4 heuristic (criterion 'dt'/'acc', no
   farmFraction) fall back to their stored verdict — EXCEPT mania, whose old
   'acc' rule (>=70% of the board SS'd, flat) is the one that was wrong: it
   flagged huge popular maps regardless of SR inflation. So a not-yet-v4
   mania record counts as unclassified (false) until the crawl recomputes
   it, rather than showing a verdict we've since rejected. */
function isFarmMap(mode, r) {
    const fs = r.farmSignal;
    if (!fs) return false;
    if (fs.criterion !== 'ease-v4' || typeof fs.farmFraction !== 'number') {
        return mode === 'mania' ? false : !!fs.isFarm;
    }
    const nmStars = Number.isFinite(fs.nmStars) ? fs.nmStars
        : (r.stars && Number.isFinite(r.stars.NM) ? r.stars.NM : null);
    return (fs.sampleSize || 0) >= FARM_MIN_SAMPLE
        && (fs.playcount || 0) >= farmPlaycountFloor(mode)
        && fs.farmFraction >= farmThresholdForStars(mode, nmStars);
}

function sorter(field, dir) {
    const mul = dir === 'asc' ? 1 : -1;
    return (a, b) => mul * ((a[field] ?? 0) - (b[field] ?? 0));
}

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const mode = MODE_NUM[qs.mode] !== undefined ? qs.mode : 'osu';
    const mods = MODS_SET.has(qs.mods) ? qs.mods : 'NM';
    const page = Math.max(0, parseInt(qs.page, 10) || 0);
    // Callers that want a bigger single page (the practice-collection
    // generator, the Discord bot's exports) can raise it up to 200.
    const pageSize = Math.max(1, Math.min(200, parseInt(qs.limit, 10) || PAGE_SIZE));
    const q = (qs.q || '').trim().toLowerCase().slice(0, 100);
    const farmOnly = qs.farmOnly === '1';
    // `pick`: return ONE record instead of a page — 'random' or an absolute
    // index (wrapped). Lets the Discord bot's /farm + its ◀▶ buttons do a
    // single round-trip instead of a probe + a page fetch.
    const pick = qs.pick;

    const num = (v) => (v !== undefined && v !== '' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const ppMin = num(qs.ppMin), ppMax = num(qs.ppMax);
    const starMin = num(qs.starMin), starMax = num(qs.starMax);
    const bpmMin = num(qs.bpmMin), bpmMax = num(qs.bpmMax);
    const lengthMin = num(qs.lengthMin), lengthMax = num(qs.lengthMax);
    const arMin = num(qs.arMin), arMax = num(qs.arMax);
    const csMin = num(qs.csMin), csMax = num(qs.csMax);
    const srMin = num(qs.srMin), srMax = num(qs.srMax);

    const [sortField, sortDir] = (qs.sort || 'pp_desc').split('_');
    const SORT_FIELDS = { pp: '__pp', star: '__star', bpm: 'bpm', length: 'total_length', new: 'firstSeenAt' };
    const sortKey = SORT_FIELDS[sortField] ? sortField : 'pp';

    try {
        const store = getFarmMapsStore();
        const dataset = await loadDataset(store, mode);
        const crawlState = (await store.get(`crawl-state:${mode}`, { type: 'json' })) || {};

        let items = dataset.map(r => {
            const a = r.aim && r.aim[mods];
            const sp = r.speed && r.speed[mods];
            // speed's share of aim+speed difficulty: >0.5 stream-leaning,
            // <0.5 aim/jump-leaning. undefined for records not yet recrawled
            // with aim/speed.
            const sr = (a != null && sp != null && a + sp > 0) ? sp / (a + sp) : undefined;
            return { ...r, __pp: r.pp ? r.pp[mods] : undefined, __star: r.stars ? r.stars[mods] : undefined, __sr: sr };
        }).filter(r => r.__pp !== undefined && r.__star !== undefined);

        const farmClassifiedCount = items.filter(r => r.farmSignal).length;
        const farmMapCount = items.filter(r => isFarmMap(mode, r)).length;
        if (farmOnly) items = items.filter(r => isFarmMap(mode, r));

        if (ppMin !== null) items = items.filter(r => r.__pp >= ppMin);
        if (ppMax !== null) items = items.filter(r => r.__pp <= ppMax);
        if (starMin !== null) items = items.filter(r => r.__star >= starMin);
        if (starMax !== null) items = items.filter(r => r.__star <= starMax);
        if (bpmMin !== null) items = items.filter(r => (r.bpm || 0) >= bpmMin);
        if (bpmMax !== null) items = items.filter(r => (r.bpm || 0) <= bpmMax);
        if (lengthMin !== null) items = items.filter(r => (r.total_length || 0) >= lengthMin);
        if (lengthMax !== null) items = items.filter(r => (r.total_length || 0) <= lengthMax);
        if (arMin !== null) items = items.filter(r => r.ar != null && r.ar >= arMin);
        if (arMax !== null) items = items.filter(r => r.ar != null && r.ar <= arMax);
        if (csMin !== null) items = items.filter(r => r.cs != null && r.cs >= csMin);
        if (csMax !== null) items = items.filter(r => r.cs != null && r.cs <= csMax);
        if (srMin !== null) items = items.filter(r => r.__sr != null && r.__sr >= srMin);
        if (srMax !== null) items = items.filter(r => r.__sr != null && r.__sr <= srMax);
        if (q) {
            items = items.filter(r =>
                (r.title || '').toLowerCase().includes(q) ||
                (r.artist || '').toLowerCase().includes(q) ||
                (r.creator || '').toLowerCase().includes(q)
            );
        }

        items.sort(sorter(SORT_FIELDS[sortKey], sortDir));
        const total = items.length;
        const project = ({ __pp, __star, __sr, ...r }) => ({ ...r, pp: __pp, star: __star, speedRatio: __sr != null ? __sr : null });

        const coverage = {
            datasetSize: dataset.length,
            discoveredCount: crawlState.discoveredCount || 0,
            computedCount: crawlState.computedCount || 0,
            totalKnown: crawlState.totalKnown || 0,
            lastRunAt: crawlState.lastRunAt || null,
            lastOkAt: crawlState.lastOkAt || null,
            lastError: crawlState.lastError || null,
            consecutiveWriteFails: crawlState.consecutiveWriteFails || 0,
            farmClassifiedCount,
            farmMapCount,
        };

        if (pick !== undefined) {
            let pickIndex = -1;
            if (total > 0) {
                pickIndex = pick === 'random'
                    ? Math.floor(Math.random() * total)
                    : (((parseInt(pick, 10) || 0) % total) + total) % total;
            }
            return {
                statusCode: 200,
                headers: { ...headers, 'Cache-Control': 'no-store' },
                body: JSON.stringify({
                    items: pickIndex >= 0 ? [project(items[pickIndex])] : [],
                    total,
                    pickIndex,
                    page: 0,
                    pageSize: 1,
                    coverage,
                }),
            };
        }

        const pageItems = items
            .slice(page * pageSize, (page + 1) * pageSize)
            .map(project);

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=300' },
            body: JSON.stringify({
                items: pageItems,
                total,
                page,
                pageSize,
                coverage,
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
