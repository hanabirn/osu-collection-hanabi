/* Public, unauthenticated read side of a gallery collection's comments
   (js/gallery-comments.js) — see gallery-comments-post.js for the write
   side. Unlike chat's cursor-based polling, this isn't a live-updating
   feed the client keeps open — it's loaded once whenever the gallery
   detail modal opens, so a plain "give me everything for this owner" GET
   is enough; no `after` cursor needed. */
const { getGalleryCommentsStore } = require('./_blobs-store');

const MAX_RETURNED = 200;

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
    const ownerId = qs.ownerId && /^\d+$/.test(qs.ownerId) ? qs.ownerId : null;
    if (!ownerId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid ownerId' }) };
    }

    try {
        const store = getGalleryCommentsStore();
        const all = (await store.get(`comments:${ownerId}`, { type: 'json' })) || [];
        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=10' },
            body: JSON.stringify({ comments: all.slice(-MAX_RETURNED) }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
