/* Public, paginated, lightweight listing for the collection gallery — no
   auth required. Returns metadata only (never full collections, see
   collections-get.js for that) so browsing the list stays cheap regardless
   of how large individual published collections are.

   Auth is optional here (unlike collections-publish/unpublish/like, which
   require it): a Bearer token is only used to annotate each returned item
   with likedByMe and, if ?likedOnly=1, to restrict the list to collections
   the caller has liked (see collections-like.js for the likedBy:{id} blob
   this reads). Without a token those features are simply unavailable and
   the list behaves exactly as before. */
const { getCollectionsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const PAGE_SIZE = 20;
const SORTERS = {
    recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    sets: (a, b) => b.totalSets - a.totalSets,
    rating: (a, b) => b.maxRating - a.maxRating,
    likes: (a, b) => (b.likeCount || 0) - (a.likeCount || 0),
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
    const q = (qs.q || '').trim().toLowerCase().slice(0, 100);
    const tag = (qs.tag || '').trim().slice(0, 100);
    const likedOnly = qs.likedOnly === '1';

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const caller = token ? verifyAuthToken(token) : null;

    if (likedOnly && !caller) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    try {
        const store = getCollectionsStore();
        const index = (await store.get('index', { type: 'json' })) || [];

        let likedSet = null;
        if (caller) {
            const likedBy = (await store.get(`likedBy:${caller.id}`, { type: 'json' })) || [];
            likedSet = new Set(likedBy);
        }

        let filtered = index;
        if (likedOnly) filtered = filtered.filter(entry => likedSet.has(entry.id));
        if (tag) filtered = filtered.filter(entry => Array.isArray(entry.tags) && entry.tags.includes(tag));
        if (q) {
            filtered = filtered.filter(entry => {
                if ((entry.username || '').toLowerCase().includes(q)) return true;
                return Array.isArray(entry.tags) && entry.tags.some(t => t.toLowerCase().includes(q));
            });
        }

        const sorted = [...filtered].sort(SORTERS[sort]);
        const items = sorted
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map(entry => ({ ...entry, likedByMe: likedSet ? likedSet.has(entry.id) : false }));

        return {
            statusCode: 200,
            // A caller identity makes the response per-user (likedByMe), so
            // it must never be cached publicly — a shared/CDN cache serving
            // one visitor's likedByMe to another would be a real bug, not
            // just a staleness nit.
            headers: { ...headers, 'Cache-Control': caller ? 'private, no-store' : 'public, max-age=15' },
            body: JSON.stringify({ items, total: sorted.length, page, pageSize: PAGE_SIZE }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
