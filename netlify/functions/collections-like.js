/* Toggles a like from the caller (verified via Bearer token, same as
   collections-publish.js) onto another user's published collection.
   Maintains two blob-backed indices — likers:{targetId} (who liked this
   collection; the source of truth for the count and for detecting an
   existing like) and likedBy:{likerId} (which collections this caller has
   liked; read by collections-list.js to mark hearts / power the "liked
   only" filter) — plus caches the resulting count on the gallery index
   entry so sorting by popularity doesn't need to read every likers: blob. */
const { getCollectionsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const targetId = body && body.targetId != null ? String(body.targetId) : null;
    if (!targetId || !/^\d+$/.test(targetId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid targetId' }) };
    }
    if (targetId === user.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't like your own collection" }) };
    }

    try {
        const store = getCollectionsStore();
        const index = (await store.get('index', { type: 'json' })) || [];
        const entryIdx = index.findIndex(entry => entry.id === targetId);
        if (entryIdx === -1) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Collection not found' }) };
        }

        const likers = (await store.get(`likers:${targetId}`, { type: 'json' })) || [];
        const likedBy = (await store.get(`likedBy:${user.id}`, { type: 'json' })) || [];

        const alreadyLiked = likers.includes(user.id);
        const nextLikers = alreadyLiked ? likers.filter(id => id !== user.id) : [...likers, user.id];
        const nextLikedBy = alreadyLiked ? likedBy.filter(id => id !== targetId) : [...likedBy, targetId];

        await store.setJSON(`likers:${targetId}`, nextLikers);
        await store.setJSON(`likedBy:${user.id}`, nextLikedBy);

        index[entryIdx] = { ...index[entryIdx], likeCount: nextLikers.length };
        await store.setJSON('index', index);

        return { statusCode: 200, headers, body: JSON.stringify({ liked: !alreadyLiked, likeCount: nextLikers.length }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
