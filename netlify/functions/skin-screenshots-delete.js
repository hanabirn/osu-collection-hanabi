/* Deletes one of the caller's own published screenshots — cross-checks the
   id against the caller's own owner:{userId} list (same ownership-check
   pattern as skins-download.js) before touching anything, so one user's
   token can't delete another user's screenshot even if they guessed a
   valid-looking id. Doesn't bother cleaning up other users' likedBy:{id}
   entries that may still reference the deleted id — harmless dangling
   references, since every read path (skin-screenshots-list.js) filters
   likedByMe/likedOnly against the current index, and the deleted entry is
   gone from there regardless. */
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

    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
    }

    try {
        const store = getSkinScreenshotsStore();
        const owned = (await store.get(`owner:${user.id}`, { type: 'json' })) || [];
        if (!owned.includes(id)) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Screenshot not found' }) };
        }

        await store.delete(`image:${id}`);
        await store.delete(`osk:${id}`);
        await store.delete(`likers:${id}`);
        await store.setJSON(`owner:${user.id}`, owned.filter(v => v !== id));

        const index = (await store.get('index', { type: 'json' })) || [];
        await store.setJSON('index', index.filter(entry => entry.id !== id));

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
