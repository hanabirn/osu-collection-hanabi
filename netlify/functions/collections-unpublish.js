/* Removes the caller's collection from the public gallery. Idempotent —
   always returns 200 even if nothing was published, so the client doesn't
   need to pre-check publish state before showing an "Unpublish" button. */
const { getStore } = require('@netlify/blobs');
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

    try {
        const store = getStore('osu-public-collections');
        await store.delete(`full:${user.id}`);

        const index = (await store.get('index', { type: 'json' })) || [];
        const hadEntry = index.some(entry => entry.id === user.id);
        if (hadEntry) {
            await store.setJSON('index', index.filter(entry => entry.id !== user.id));
        }

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyUnpublished: !hadEntry }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
