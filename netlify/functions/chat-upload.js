/* Uploads one image/GIF for the chat room (js/chat.js) and returns a
   `mediaId`. The client then passes that id to chat-send.js, which stores it
   on the message; chat-media.js streams the bytes back. Requires a verified
   osu! login (accountability — this site has no moderation panel, the owner
   can delete via chat-delete.js). Kill switch: set CHAT_MEDIA_DISABLED to
   turn the whole feature off fast if it gets abused.

   The image bytes travel base64 in the JSON body; 4 MB raw keeps that under
   Netlify Functions' ~6 MB ceiling. Content-type is sniffed from the magic
   bytes, never trusted from the client. */
const crypto = require('crypto');
const { getChatMediaStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');
const { MAX_MEDIA_BYTES, ALLOWED_MEDIA_MIME, sniffImageMime } = require('./_chat-shared');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_BODY_BYTES = 5.7 * 1024 * 1024;
const UPLOAD_COOLDOWN_MS = 8000;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    if (process.env.CHAT_MEDIA_DISABLED) {
        return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Image uploads are currently disabled' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    if (!event.body || Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
        return { statusCode: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request too large' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    if (!dataBase64) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing image data' }) };
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, 'base64');
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid image data' }) };
    }
    if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
        return { statusCode: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: `Image exceeds the ${MAX_MEDIA_BYTES / 1024 / 1024}MB limit` }) };
    }

    const mime = sniffImageMime(buffer);
    if (!mime || !ALLOWED_MEDIA_MIME.includes(mime)) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'File must be a PNG, JPEG, GIF or WebP image' }) };
    }

    try {
        const store = getChatMediaStore();

        const lastUploadAt = await store.get(`lastUploadAt:${user.id}`, { type: 'text' });
        if (lastUploadAt && Date.now() - parseInt(lastUploadAt, 10) < UPLOAD_COOLDOWN_MS) {
            return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Uploading too fast, please slow down' }) };
        }

        const id = crypto.randomUUID();
        await store.set(`media:${id}`, buffer, {
            metadata: { mime, authorId: user.id, createdAt: new Date().toISOString() },
        });
        await store.set(`lastUploadAt:${user.id}`, String(Date.now()));

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ mediaId: id, mime }),
        };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
