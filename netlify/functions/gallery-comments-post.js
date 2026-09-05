/* Posts a comment on a published gallery collection (js/gallery-comments.js)
   — see gallery-comments-list.js for the read side. Identity (authorId/
   authorUsername) always comes from the verified osu! login token
   (_auth-token.js, same as chat-send.js/collections-publish.js), never from
   the request body. `ownerId` just says *which* collection's comment
   thread to append to — it isn't a permission check by itself, since
   anyone logged in can comment on anyone's public gallery entry; the actual
   collection data behind it is untouched either way. */
const { getGalleryCommentsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_CONTENT_LENGTH = 300;
const MAX_COMMENTS = 200;
const POST_COOLDOWN_MS = 3000;

// Same best-effort country lookup chat-send.js makes — the signed login
// token only carries {id, username}, so this is a fresh v1 get_user call
// per comment. A failure just means the comment shows no flag.
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

    const ownerId = typeof body.ownerId === 'string' && /^\d+$/.test(body.ownerId) ? body.ownerId
        : (Number.isInteger(body.ownerId) ? String(body.ownerId) : null);
    if (!ownerId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or invalid ownerId' }) };
    }

    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment is empty' }) };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: `Comment exceeds ${MAX_CONTENT_LENGTH} characters` }) };
    }

    try {
        const store = getGalleryCommentsStore();

        const lastPostAt = await store.get(`lastPostAt:${user.id}`, { type: 'text' });
        if (lastPostAt && Date.now() - parseInt(lastPostAt, 10) < POST_COOLDOWN_MS) {
            return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Commenting too fast, please slow down' }) };
        }

        const key = `comments:${ownerId}`;
        const comments = (await store.get(key, { type: 'json' })) || [];

        const comment = {
            id: (comments.length ? comments[comments.length - 1].id : 0) + 1,
            authorId: user.id,
            authorUsername: user.username,
            authorCountry: await resolveAuthorCountry(user.id),
            content,
            createdAt: new Date().toISOString(),
        };

        comments.push(comment);
        const trimmed = comments.slice(-MAX_COMMENTS);

        await store.setJSON(key, trimmed);
        await store.set(`lastPostAt:${user.id}`, String(Date.now()));

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ comment }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
