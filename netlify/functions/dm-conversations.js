/* Returns the caller's own DM inbox — see dm-send.js for how entries get
   created/updated and js/dm.js for the list-view rendering. Bearer-token
   scoped by construction: this only ever reads index:<user.id>, the id
   coming from the verified token, never from the request — there is no
   query param that could point this at someone else's inbox. */
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

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

    try {
        const store = getDmStore();
        const conversations = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
        const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'private, no-store' },
            body: JSON.stringify({ conversations, totalUnread }),
        };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
