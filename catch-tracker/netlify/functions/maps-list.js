/* Public, filtered/paginated view over the catch map catalog (maps:catch,
   written by maps-crawl-cron.js / maps-crawl-run.js — see
   _maps-crawl-core.js). Same pure read-only GET + TTL cache + honest
   coverage-block shape as this site's other *-list.js endpoints. */
const { getMapsStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');

const PAGE_SIZE = 24;
const DS_CACHE_TTL_MS = 60_000;
let _dsCache = { at: 0, maps: null };

async function loadMaps(store) {
    const now = Date.now();
    if (_dsCache.maps && now - _dsCache.at < DS_CACHE_TTL_MS) return _dsCache.maps;
    const maps = (await getJSONGz(store, 'maps:catch')) || [];
    _dsCache = { at: now, maps };
    return maps;
}

const SORTERS = {
    star_desc: (a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0),
    star_asc: (a, b) => (a.difficulty_rating || 0) - (b.difficulty_rating || 0),
    bpm_desc: (a, b) => (b.bpm || 0) - (a.bpm || 0),
    length_desc: (a, b) => (b.total_length || 0) - (a.total_length || 0),
    newest: (a, b) => new Date(b.ranked_date || 0) - new Date(a.ranked_date || 0),
};

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const q = (qs.q || '').trim().toLowerCase().slice(0, 100);
    const status = qs.status === 'ranked' || qs.status === 'loved' ? qs.status : null;
    const page = Math.max(0, parseInt(qs.page, 10) || 0);
    const pageSize = Math.max(1, Math.min(60, parseInt(qs.limit, 10) || PAGE_SIZE));
    const sortKey = SORTERS[qs.sort] ? qs.sort : 'star_desc';

    const num = (v) => (v !== undefined && v !== '' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const starMin = num(qs.starMin), starMax = num(qs.starMax);
    const bpmMin = num(qs.bpmMin), bpmMax = num(qs.bpmMax);
    const lengthMin = num(qs.lengthMin), lengthMax = num(qs.lengthMax);

    try {
        const store = getMapsStore();
        const maps = await loadMaps(store);

        let items = maps;
        if (status) items = items.filter(r => r.status === status);
        if (q) {
            items = items.filter(r =>
                (r.title || '').toLowerCase().includes(q) ||
                (r.artist || '').toLowerCase().includes(q) ||
                (r.creator || '').toLowerCase().includes(q)
            );
        }
        if (starMin !== null) items = items.filter(r => (r.difficulty_rating || 0) >= starMin);
        if (starMax !== null) items = items.filter(r => (r.difficulty_rating || 0) <= starMax);
        if (bpmMin !== null) items = items.filter(r => (r.bpm || 0) >= bpmMin);
        if (bpmMax !== null) items = items.filter(r => (r.bpm || 0) <= bpmMax);
        if (lengthMin !== null) items = items.filter(r => (r.total_length || 0) >= lengthMin);
        if (lengthMax !== null) items = items.filter(r => (r.total_length || 0) <= lengthMax);

        items = [...items].sort(SORTERS[sortKey]);
        const total = items.length;
        const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);

        const state = (await store.get('maps-crawl-state', { type: 'json' })) || {};
        const coverage = {
            datasetSize: maps.length,
            countsByStatus: state.countsByStatus || {},
            sweepCount: state.sweepCount || 0,
            lastRunAt: state.lastRunAt || null,
            lastOkAt: state.lastOkAt || null,
            lastError: state.lastError || null,
        };

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=120' },
            body: JSON.stringify({ items: pageItems, total, page, pageSize, coverage }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
