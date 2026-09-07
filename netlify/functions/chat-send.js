/* Posts a message to the site's chat room (js/chat.js) — see chat-list.js
   for the read side. Identity (authorId/authorUsername) always comes from
   the verified osu! login token (_auth-token.js, same as
   collections-publish.js/collections-like.js), never from the request body,
   so nobody can post under someone else's name.

   Differentiator vs. a plain text chat: if the message contains an
   osu.ppy.sh beatmap/beatmapset link, it's resolved server-side into a
   `beatmapPreview` the client renders as a card with a one-click "add to my
   collection" button (js/chat.js reuses the existing addOsuBeatmap() for
   that — this function only needs to describe the beatmapset, not write
   anything to anyone's collection). Resolution uses the same v1
   get_beatmaps API this site's own netlify/functions/osu.js already proxies
   (OSU_API_KEY), not OAuth — simplest path, and this site fetches
   beatmapsets this way everywhere else already. */
const { getChatStore, getChatMediaStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');
const {
    MAX_CONTENT_LENGTH, MAX_MESSAGES, REPLY_SNIPPET_LENGTH, resolveBeatmapPreview,
    ALLOWED_MEDIA_MIME,
} = require('./_chat-shared');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const POST_COOLDOWN_MS = 3000;

// Best-effort, same philosophy as the country lookup in publishMyCollection()
// — the signed login token only carries {id, username} (see _auth-token.js),
// so this is a fresh v1 get_user call per message. A failure just means the
// chat card shows no flag, never blocks the send.
async function resolveAuthorCountry(userId) {
    try {
        const params = new URLSearchParams({ k: process.env.OSU_API_KEY, u: userId, type: 'id' });
        const res = await fetch(`https://osu.ppy.sh/api/get_user?${params.toString()}`);
        const users = await res.json();
        return Array.isArray(users) && users[0] ? (users[0].country || null) : null;
    } catch {
        return null;
    }
}

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

    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const mediaId = typeof body.mediaId === 'string' && /^[0-9a-f-]{36}$/i.test(body.mediaId) ? body.mediaId : null;
    if (!content && !mediaId) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message is empty' }) };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: `Message exceeds ${MAX_CONTENT_LENGTH} characters` }) };
    }
    const replyToId = Number.isInteger(body.replyToId) ? body.replyToId : null;

    try {
        const store = getChatStore();

        const lastPostAt = await store.get(`lastPostAt:${user.id}`, { type: 'text' });
        if (lastPostAt && Date.now() - parseInt(lastPostAt, 10) < POST_COOLDOWN_MS) {
            return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Sending too fast, please slow down' }) };
        }

        const messages = (await store.get('messages', { type: 'json' })) || [];

        let replyAuthorUsername = null;
        let replyContent = null;
        if (replyToId != null) {
            const target = messages.find(m => m.id === replyToId);
            if (target) {
                replyAuthorUsername = target.authorUsername;
                replyContent = target.content.length > REPLY_SNIPPET_LENGTH
                    ? target.content.slice(0, REPLY_SNIPPET_LENGTH) + '…'
                    : (target.content || (target.media ? '🖼️' : ''));
            }
        }

        // Confirm the upload exists and is this caller's — a message can't
        // point at someone else's (or a bogus) media id.
        let media = null;
        if (mediaId) {
            try {
                const meta = await getChatMediaStore().getMetadata(`media:${mediaId}`);
                if (meta && meta.metadata && String(meta.metadata.authorId) === String(user.id)
                    && ALLOWED_MEDIA_MIME.includes(meta.metadata.mime)) {
                    media = { id: mediaId, mime: meta.metadata.mime };
                }
            } catch { /* missing / unreadable — message just posts without it */ }
            if (!media) {
                return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Attachment not found, please re-upload' }) };
            }
        }

        const [beatmapPreview, authorCountry] = await Promise.all([
            resolveBeatmapPreview(content),
            resolveAuthorCountry(user.id),
        ]);

        const message = {
            id: (messages.length ? messages[messages.length - 1].id : 0) + 1,
            authorId: user.id,
            authorUsername: user.username,
            authorCountry,
            content,
            beatmapsetId: beatmapPreview ? beatmapPreview.beatmapsetId : null,
            beatmapPreview,
            media,
            replyToId: replyAuthorUsername ? replyToId : null,
            replyAuthorUsername,
            replyContent,
            createdAt: new Date().toISOString(),
        };

        messages.push(message);
        const trimmed = messages.slice(-MAX_MESSAGES);

        // Best-effort: drop the blobs for messages that just fell out of the
        // ring buffer so orphaned media doesn't accumulate forever.
        const survivingIds = new Set(trimmed.map(m => m.id));
        const droppedMedia = messages
            .filter(m => m.media && m.media.id && !survivingIds.has(m.id))
            .map(m => m.media.id);
        for (const gone of droppedMedia) {
            try { await getChatMediaStore().delete(`media:${gone}`); } catch { /* ignore */ }
        }

        await store.setJSON('messages', trimmed);
        await store.set(`lastPostAt:${user.id}`, String(Date.now()));

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ message }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
