/* Edits one chat message (js/chat.js). Self-only — unlike chat-delete.js,
   the site owner is NOT allowed to edit other people's messages (deleting a
   message is fine moderation; rewriting someone else's words is not). The
   edited message re-resolves its osu! beatmap-link card via the same helper
   chat-send.js uses, and gets an `editedAt` stamp the client shows as a
   "(edited)" marker and polls on to repaint the message in other tabs. */
const { getChatStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');
const { MAX_CONTENT_LENGTH, resolveBeatmapPreview } = require('./_chat-shared');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const EDIT_COOLDOWN_MS = 1500;

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
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message is empty' }) };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: `Message exceeds ${MAX_CONTENT_LENGTH} characters` }) };
    }

    try {
        const store = getChatStore();

        const lastEditAt = await store.get(`lastEditAt:${user.id}`, { type: 'text' });
        if (lastEditAt && Date.now() - parseInt(lastEditAt, 10) < EDIT_COOLDOWN_MS) {
            return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Editing too fast, please slow down' }) };
        }

        const messages = (await store.get('messages', { type: 'json' })) || [];
        const idx = messages.findIndex(m => m.id === messageId);
        if (idx === -1) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message not found' }) };
        }
        if (messages[idx].authorId !== user.id) {
            return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not your message' }) };
        }
        if (messages[idx].content === content) {
            return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ message: messages[idx] }) };
        }

        const beatmapPreview = await resolveBeatmapPreview(content);
        const updated = {
            ...messages[idx],
            content,
            beatmapsetId: beatmapPreview ? beatmapPreview.beatmapsetId : null,
            beatmapPreview,
            editedAt: new Date().toISOString(),
        };
        messages[idx] = updated;

        await store.setJSON('messages', messages);
        await store.set(`lastEditAt:${user.id}`, String(Date.now()));

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ message: updated }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
