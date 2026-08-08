/* Removes one skin from the caller's cloud backup. Idempotent — same
   reasoning as collections-unpublish.js, the "delete" button on the client
   doesn't need to pre-check whether the entry still exists. */
const { getSkinBackupsStore } = require('./_blobs-store');
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
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
    }

    try {
        const store = getSkinBackupsStore();
        const index = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        await store.setJSON(`index:${user.id}`, index.filter(e => e.id !== id));
        await store.delete(`file:${user.id}:${id}`);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
