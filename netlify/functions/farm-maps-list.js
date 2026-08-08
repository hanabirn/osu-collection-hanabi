/* Public, filtered/sorted/paginated listing over the precomputed Farm Maps
   dataset — modeled directly on collections-list.js. No auth: this is a
   read-only view over server-computed PP data, not per-caller state.
   The dataset itself is built by farm-crawl-cron.js / farm-crawl-run.js
   (see _farm-crawl-core.js) and is necessarily partial/growing rather than
   a complete ranked-pool snapshot — the `coverage` block in the response
   lets the frontend say so honestly instead of implying completeness. */
const { getFarmMapsStore } = require('./_blobs-store');
const { MOD_COMBOS, MODE_NUM } = require('./_farm-constants');

const PAGE_SIZE = 20;
const MODS_SET = new Set(MOD_COMBOS.map(m => m || 'NM'));

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
    const q = (qs.q || '').trim().toLowerCase().slice(0, 100);

    const num = (v) => (v !== undefined && v !== '' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const ppMin = num(qs.ppMin), ppMax = num(qs.ppMax);
    const starMin = num(qs.starMin), starMax = num(qs.starMax);
    const bpmMin = num(qs.bpmMin), bpmMax = num(qs.bpmMax);
    const lengthMin = num(qs.lengthMin), lengthMax = num(qs.lengthMax);

    const [sortField, sortDir] = (qs.sort || 'pp_desc').split('_');
    const SORT_FIELDS = { pp: '__pp', star: '__star', bpm: 'bpm', length: 'total_length', new: 'firstSeenAt' };
    const sortKey = SORT_FIELDS[sortField] ? sortField : 'pp';

    try {
        const store = getFarmMapsStore();
        const dataset = (await store.get(`dataset:${mode}`, { type: 'json' })) || [];
        const crawlState = (await store.get(`crawl-state:${mode}`, { type: 'json' })) || {};

        let items = dataset.map(r => ({ ...r, __pp: r.pp ? r.pp[mods] : undefined, __star: r.stars ? r.stars[mods] : undefined }))
            .filter(r => r.__pp !== undefined && r.__star !== undefined);

        if (ppMin !== null) items = items.filter(r => r.__pp >= ppMin);
        if (ppMax !== null) items = items.filter(r => r.__pp <= ppMax);
        if (starMin !== null) items = items.filter(r => r.__star >= starMin);
        if (starMax !== null) items = items.filter(r => r.__star <= starMax);
        if (bpmMin !== null) items = items.filter(r => (r.bpm || 0) >= bpmMin);
        if (bpmMax !== null) items = items.filter(r => (r.bpm || 0) <= bpmMax);
        if (lengthMin !== null) items = items.filter(r => (r.total_length || 0) >= lengthMin);
        if (lengthMax !== null) items = items.filter(r => (r.total_length || 0) <= lengthMax);
        if (q) {
            items = items.filter(r =>
                (r.title || '').toLowerCase().includes(q) ||
                (r.artist || '').toLowerCase().includes(q) ||
                (r.creator || '').toLowerCase().includes(q)
            );
        }

        items.sort(sorter(SORT_FIELDS[sortKey], sortDir));
        const total = items.length;
        const pageItems = items
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map(({ __pp, __star, ...r }) => ({ ...r, pp: __pp, star: __star }));

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=300' },
            body: JSON.stringify({
                items: pageItems,
                total,
                page,
                pageSize: PAGE_SIZE,
                coverage: {
                    discoveredCount: crawlState.discoveredCount || 0,
                    computedCount: crawlState.computedCount || 0,
                    totalKnown: crawlState.totalKnown || 0,
                    lastRunAt: crawlState.lastRunAt || null,
                },
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
