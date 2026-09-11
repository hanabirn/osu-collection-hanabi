/* Public, paginated view over the TW catch pp-rankings (rankings:TW,
   written by rankings-crawl-cron.js / rankings-crawl-run.js — see
   _rankings-crawl-core.js). Same pure read-only GET + TTL cache + honest
   coverage-block shape as feed-list.js / the main site's farm-maps-list.js. */
const { getRankingsStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');

const PAGE_SIZE = 50;
const DS_CACHE_TTL_MS = 60_000; // rankings move slowly, fine to cache longer than the feed
let _dsCache = { at: 0, rankings: null };

async function loadRankings(store) {
    const now = Date.now();
    if (_dsCache.rankings && now - _dsCache.at < DS_CACHE_TTL_MS) return _dsCache.rankings;
    const rankings = (await getJSONGz(store, 'rankings:TW')) || [];
    _dsCache = { at: now, rankings };
    return rankings;
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
    const page = Math.max(0, parseInt(qs.page, 10) || 0);
    const pageSize = Math.max(1, Math.min(100, parseInt(qs.limit, 10) || PAGE_SIZE));

    try {
        const store = getRankingsStore();
        const rankings = await loadRankings(store);

        const sorted = [...rankings].sort((a, b) => (b.pp || 0) - (a.pp || 0));
        const total = sorted.length;
        const pageItems = sorted.slice(page * pageSize, (page + 1) * pageSize);

        const state = (await store.get('rankings-crawl-state', { type: 'json' })) || {};
        const coverage = {
            datasetSize: rankings.length,
            totalKnown: state.totalKnown || null,
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
