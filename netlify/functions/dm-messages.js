/* Reads one conversation's messages — see dm-send.js for the write side and
   the message shape. Bearer-token scoped by construction: the conversation
   key is built from the *caller's own verified id* plus whatever `with` id
   they ask for, so a caller can only ever address conversations they're
   actually part of — there's no way to pass someone else's pair of ids. */
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const FIRST_LOAD_COUNT = 60;

function convKey(idA, idB) {
    const [lo, hi] = [String(idA), String(idB)].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    return `conv:${lo}:${hi}`;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    const qs = event.queryStringParameters || {};
    const withId = qs.with && /^\d+$/.test(qs.with) ? qs.with : null;
    if (!withId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or invalid "with" id' }) };
    }
    const after = qs.after && /^\d+$/.test(qs.after) ? parseInt(qs.after, 10) : null;

    try {
        const store = getDmStore();
        const all = (await store.get(convKey(user.id, withId), { type: 'json' })) || [];
        const messages = after != null ? all.filter(m => m.id > after) : all.slice(-FIRST_LOAD_COUNT);

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'private, no-store' },
            body: JSON.stringify({ messages }),
        };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
