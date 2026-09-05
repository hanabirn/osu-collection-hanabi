/* Deletes one gallery comment (js/gallery-comments.js) — the comment's own
   author, the owner of the collection being commented on (moderating their
   own gallery post, same as any comments section lets a poster do), or the
   site owner (same single-admin allowlist chat-delete.js uses, for the same
   reason: a public, unmoderated-by-default text box needs *some* safety
   valve and a full roles system is overkill for a solo-dev site). */
const { getGalleryCommentsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const SITE_OWNER_OSU_ID = process.env.CHAT_OWNER_OSU_ID || '26696007';

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
    const commentId = Number.isInteger(body.commentId) ? body.commentId : null;
    if (!ownerId || commentId == null) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing ownerId or commentId' }) };
    }

    try {
        const store = getGalleryCommentsStore();
        const key = `comments:${ownerId}`;
        const comments = (await store.get(key, { type: 'json' })) || [];
        const target = comments.find(c => c.id === commentId);
        if (!target) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Comment not found' }) };
        }
        const isOwnComment = String(target.authorId) === String(user.id);
        const isGalleryOwner = String(ownerId) === String(user.id);
        const isSiteOwner = String(user.id) === SITE_OWNER_OSU_ID;
        if (!isOwnComment && !isGalleryOwner && !isSiteOwner) {
            return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not your comment' }) };
        }

        const remaining = comments.filter(c => c.id !== commentId);
        await store.setJSON(key, remaining);

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
