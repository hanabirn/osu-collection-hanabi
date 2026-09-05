/* Marks one conversation as read — zeroes unreadCount on the caller's own
   index:<user.id> entry for `withId`. Called once by js/dm.js when a thread
   is opened, not on every poll, so an open thread's own polling never races
   a "mark read" from another tab. Bearer-token scoped by construction, same
   as every other dm-*.js function — this only ever touches the token's own
   inbox. */
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
    const withId = typeof body.withId === 'string' || typeof body.withId === 'number' ? String(body.withId) : null;
    if (!withId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing withId' }) };
    }

    try {
        const store = getDmStore();
        const index = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        const entryIdx = index.findIndex(c => c.partnerId === withId);
        if (entryIdx >= 0 && index[entryIdx].unreadCount) {
            index[entryIdx] = { ...index[entryIdx], unreadCount: 0 };
            await store.setJSON(`index:${user.id}`, index);
        }

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
