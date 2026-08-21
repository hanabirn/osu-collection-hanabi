/* Public, paginated, lightweight listing for the skin screenshot plaza — no
   auth required to browse. Same shape as collections-list.js: the caller's
   Bearer token (if any) is only used to annotate items with likedByMe and,
   if ?likedOnly=1, to restrict the list to screenshots the caller has
   liked. Image bytes are never included here (see
   skin-screenshots-image.js) so paging through the gallery stays cheap. */
const { getSkinScreenshotsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const PAGE_SIZE = 20;
const SORTERS = {
    recent: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
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
    const mode = ['standard', 'taiko', 'catch', 'mania'].includes(qs.mode) ? qs.mode : '';
    const likedOnly = qs.likedOnly === '1';
    const mine = qs.mine === '1';

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const caller = token ? verifyAuthToken(token) : null;

    if ((likedOnly || mine) && !caller) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    try {
        const store = getSkinScreenshotsStore();
        const index = (await store.get('index', { type: 'json' })) || [];

        let likedSet = null;
        if (caller) {
            const likedBy = (await store.get(`likedBy:${caller.id}`, { type: 'json' })) || [];
            likedSet = new Set(likedBy);
        }

        let filtered = index;
        if (mine) filtered = filtered.filter(entry => entry.userId === caller.id);
        if (likedOnly) filtered = filtered.filter(entry => likedSet.has(entry.id));
        if (mode) filtered = filtered.filter(entry => entry.mode === mode);
        if (q) {
            filtered = filtered.filter(entry =>
                (entry.skinName || '').toLowerCase().includes(q) ||
                (entry.author || '').toLowerCase().includes(q) ||
                (entry.username || '').toLowerCase().includes(q)
            );
        }

        const sorted = [...filtered].sort(SORTERS[sort]);
        const items = sorted
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map(entry => ({ ...entry, likedByMe: likedSet ? likedSet.has(entry.id) : false }));

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': caller ? 'private, no-store' : 'public, max-age=15' },
            body: JSON.stringify({ items, total: sorted.length, page, pageSize: PAGE_SIZE }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
