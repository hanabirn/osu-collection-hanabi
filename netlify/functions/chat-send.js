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
const { getChatStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_CONTENT_LENGTH = 300;
const MAX_MESSAGES = 300;
const POST_COOLDOWN_MS = 3000;
const REPLY_SNIPPET_LENGTH = 120;

// Matches /beatmapsets/<id>, /beatmaps/<id> and the legacy /s/<id> — same
// shapes parseOsuInput() in js/osu.js already recognizes on the client,
// reimplemented here since this runs in a different runtime.
const BEATMAP_URL_RE = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|s)\/(\d+)/i;

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

async function resolveBeatmapPreview(content) {
    const match = content.match(BEATMAP_URL_RE);
    if (!match) return null;
    const id = match[1];

    try {
        const params = new URLSearchParams({ k: process.env.OSU_API_KEY, s: id });
        let res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`);
        let beatmaps = await res.json();

        // The matched id might be a single-difficulty beatmap id rather than
        // a beatmapset id (e.g. /beatmaps/<diffId>) — retry as `b=` and
        // re-fetch the whole set, same fallback addOsuBeatmap() itself uses.
        if (!Array.isArray(beatmaps) || beatmaps.length === 0) {
            const byMapParams = new URLSearchParams({ k: process.env.OSU_API_KEY, b: id });
            const byMapRes = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${byMapParams.toString()}`);
            const byMap = await byMapRes.json();
            if (Array.isArray(byMap) && byMap.length > 0) {
                const setParams = new URLSearchParams({ k: process.env.OSU_API_KEY, s: byMap[0].beatmapset_id });
                res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${setParams.toString()}`);
                beatmaps = await res.json();
            }
        }
        if (!Array.isArray(beatmaps) || beatmaps.length === 0) return null;

        const ratings = beatmaps.map(b => parseFloat(b.difficultyrating)).filter(r => Number.isFinite(r));
        const modes = [...new Set(beatmaps.map(b => parseInt(b.mode, 10)))].filter(m => Number.isInteger(m));

        return {
            beatmapsetId: parseInt(beatmaps[0].beatmapset_id, 10),
            title: beatmaps[0].title,
            artist: beatmaps[0].artist,
            creator: beatmaps[0].creator,
            modes,
            starMin: ratings.length ? Math.min(...ratings) : 0,
            starMax: ratings.length ? Math.max(...ratings) : 0,
        };
    } catch (err) {
        // Best-effort, same philosophy as the country lookup in
        // publishMyCollection() — a resolution failure just means the
        // message posts as plain text, never blocks the send.
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
    if (!content) {
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
                    : target.content;
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
            replyToId: replyAuthorUsername ? replyToId : null,
            replyAuthorUsername,
            replyContent,
            createdAt: new Date().toISOString(),
        };

        messages.push(message);
        const trimmed = messages.slice(-MAX_MESSAGES);

        await store.setJSON('messages', trimmed);
        await store.set(`lastPostAt:${user.id}`, String(Date.now()));

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ message }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
