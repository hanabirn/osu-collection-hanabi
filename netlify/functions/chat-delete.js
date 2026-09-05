/* Deletes one chat message (js/chat.js) — either your own (basic self-
   moderation everyone expects) or, if the caller is the site owner, any
   message (this is a public unmoderated-by-default text box visible to
   every visitor, so a single-admin allowlist is the minimum viable safety
   valve — no roles/permissions system needed for a solo-dev site). Owner id
   is env-overridable rather than only hardcoded so it can be corrected
   without a code change if it's ever wrong. */
const { getChatStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const OWNER_OSU_ID = process.env.CHAT_OWNER_OSU_ID || '26696007';

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
    const messageId = Number.isInteger(body.messageId) ? body.messageId : null;
    if (messageId == null) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing messageId' }) };
    }

    try {
        const store = getChatStore();
        const messages = (await store.get('messages', { type: 'json' })) || [];
        const target = messages.find(m => m.id === messageId);
        if (!target) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message not found' }) };
        }
        if (target.authorId !== user.id && user.id !== OWNER_OSU_ID) {
            return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not your message' }) };
        }

        const remaining = messages.filter(m => m.id !== messageId);
        await store.setJSON('messages', remaining);

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
