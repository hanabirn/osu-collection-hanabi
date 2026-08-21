/* Toggles a like on a published screenshot — same two-sided-index pattern
   as collections-like.js (likers:{targetId} / likedBy:{likerId}, likeCount
   cached onto the index entry), just keyed by a screenshot's own id
   (a UUID) instead of by the publisher's osu! user id, since one user can
   publish many screenshots here. */
const { getSkinScreenshotsStore } = require('./_blobs-store');
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

    const targetId = typeof body.targetId === 'string' ? body.targetId : '';
    if (!targetId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing targetId' }) };
    }

    try {
        const store = getSkinScreenshotsStore();
        const index = (await store.get('index', { type: 'json' })) || [];
        const entryIdx = index.findIndex(entry => entry.id === targetId);
        if (entryIdx === -1) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Screenshot not found' }) };
        }
        if (index[entryIdx].userId === user.id) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't like your own screenshot" }) };
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
