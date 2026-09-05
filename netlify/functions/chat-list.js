/* Public, unauthenticated read side of the site's chat room (js/chat.js) —
   see chat-send.js for the write side and the message shape it produces.
   Cursor-based polling: the client remembers the highest `id` it has seen
   and asks for everything after it, same trick osu-taiwan-hub.com/chat uses
   (confirmed by inspecting its own network requests) rather than a
   WebSocket/SSE connection — a single small JSON blob and a plain interval
   poll is plenty at this site's scale, and needs no persistent-connection
   infrastructure Netlify Functions don't really offer anyway. */
const { getChatStore } = require('./_blobs-store');

const FIRST_LOAD_COUNT = 60;

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
    const after = qs.after && /^\d+$/.test(qs.after) ? parseInt(qs.after, 10) : null;

    try {
        const store = getChatStore();
        const all = (await store.get('messages', { type: 'json' })) || [];
        const messages = after != null
            ? all.filter(m => m.id > after)
            : all.slice(-FIRST_LOAD_COUNT);

        return {
            statusCode: 200,
            // Short public cache: cheap to poll, but a repeat's poll interval
            // (4s) is well above this, so it's mostly just absorbing bursts.
            headers: { ...headers, 'Cache-Control': 'public, max-age=2' },
            body: JSON.stringify({ messages }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
