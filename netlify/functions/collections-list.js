/* Public, paginated, lightweight listing for the collection gallery — no
   auth required. Returns metadata only (never full collections, see
   collections-get.js for that) so browsing the list stays cheap regardless
   of how large individual published collections are. */
const { getStore } = require('@netlify/blobs');

const PAGE_SIZE = 20;
const SORTERS = {
    recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    sets: (a, b) => b.totalSets - a.totalSets,
    rating: (a, b) => b.maxRating - a.maxRating,
};

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const page = Math.max(0, parseInt(qs.page, 10) || 0);
    const sort = SORTERS[qs.sort] ? qs.sort : 'recent';

    try {
        const store = getStore('osu-public-collections');
        const index = (await store.get('index', { type: 'json' })) || [];
        const sorted = [...index].sort(SORTERS[sort]);
        const items = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=15' },
            body: JSON.stringify({ items, total: sorted.length, page, pageSize: PAGE_SIZE }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
